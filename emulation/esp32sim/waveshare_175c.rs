//! Experimental 1.75C board overlay for the pinned esp32sim revision.
//! Only the BSP-observed single-touch report, panel transfers and basic stubs are modeled.
use esp_soc::board::{BoardEdge, BoardModel, VirtualCycle};
use esp_soc::devices::co5300::Co5300;
use crate::i2c::{I2cDevice, Reg8Device, Qmi8658, ImuMotion};
use std::sync::{Arc, Mutex};
use std::collections::VecDeque;

#[derive(Default, Clone, Copy)]
struct Touch { x: u16, y: u16, down: bool }
#[derive(Default)]
struct TouchShared { current: Touch, pending: VecDeque<Touch>, notified: bool }
struct Cst9217 { state: Arc<Mutex<TouchShared>>, addr: u16, phase: u8, report: [u8; 10] }
impl Cst9217 {
    fn new(state: Arc<Mutex<TouchShared>>) -> Self { Self { state, addr: 0, phase: 0, report: [0; 10] } }
    fn snapshot(&mut self) {
        let mut state = self.state.lock().expect("CST9217 touch lock");
        let t = if self.addr == 0xd000 {
            let report = state.pending.pop_front().unwrap_or(state.current);
            state.notified = false;
            report
        } else { state.current };
        self.report = [0; 10]; self.report[6] = 0xab;
        if t.down { self.report[0] = 6; self.report[1] = (t.x >> 4) as u8;
            self.report[2] = (t.y >> 4) as u8;
            self.report[3] = ((t.x as u8 & 15) << 4) | (t.y as u8 & 15);
            self.report[5] = 1; }
    }
}
impl I2cDevice for Cst9217 {
    fn start(&mut self, read: bool) -> bool {
        if read { self.snapshot(); } else { self.phase = 0; } true
    }
    fn write(&mut self, b: u8) -> bool {
        match self.phase { 0 => { self.addr = (b as u16) << 8; self.phase = 1; },
            1 => { self.addr |= b as u16; self.phase = 2; },
            _ => { self.addr = self.addr.wrapping_add(1); } } true
    }
    fn read(&mut self) -> u8 {
        let value = match self.addr {
            0xd000..=0xd009 => self.report[(self.addr - 0xd000) as usize],
            0xd1f8 | 0xd1fa => 0xd2, 0xd1f9 | 0xd1fb => 1,
            _ => 0, // Unknown identity/configuration is not a hardware claim.
        };
        self.addr = self.addr.wrapping_add(1); value
    }
}

pub struct Waveshare175c {
    panel: Co5300, touch: Arc<Mutex<TouchShared>>, imu: Arc<ImuMotion>, cycle: VirtualCycle,
    irq_level: bool, queued: VecDeque<(VirtualCycle, bool)>, edges: Vec<BoardEdge>, gpio_events: u64,
}
impl Waveshare175c {
    pub fn new() -> Self { Self { panel: Co5300::new(466, 466, 6), touch: Default::default(),
        imu: Default::default(), cycle: 0, irq_level: true, queued: VecDeque::new(), edges: Vec::new(), gpio_events: 0 } }
}
impl BoardModel for Waveshare175c {
    fn name(&self) -> &'static str { "waveshare-amoled175c" }
    fn gpio_changes(&mut self, changes: &[(u8, bool)]) {
        self.gpio_events += changes.len() as u64;
        if changes.iter().any(|&(pin, level)| pin == 1 && !level) { self.panel.reset(); }
    }
    fn gpio_events(&self) -> u64 { self.gpio_events }
    fn spi_transfer(&mut self, host: u8, tx: &[u8], rx_len: usize) -> Vec<u8> {
        if host == 2 { self.panel.transaction(tx); } vec![0xff; rx_len]
    }
    fn i2c_devices(&mut self) -> Vec<(u8, u8, Box<dyn I2cDevice>)> {
        let mut devices: Vec<(u8, u8, Box<dyn I2cDevice>)> = Vec::new();
        // The shared physical bus may be assigned to either ESP32-S3 I2C controller.
        for bus in 0..=1 {
            devices.push((bus, 0x5a, Box::new(Cst9217::new(self.touch.clone()))));
            devices.push((bus, 0x34, Box::new(Reg8Device::new("axp2101-init-stub", &[(0x03, 0x4a)]))));
            devices.push((bus, 0x6b, Box::new(Qmi8658::new(self.imu.clone()))));
        }
        devices
    }
    fn display(&self) -> Option<(u32, u32, Vec<u16>, u64)> {
        // Preserve controller RAM; mask only the host-visible representation.
        let mut frame = self.panel.frame.clone();
        for y in 0..466i32 { for x in 0..466i32 {
            let dx = 2*x + 1 - 466; let dy = 2*y + 1 - 466;
            if dx*dx + dy*dy > 466*466 { frame[(y*466+x) as usize] = 0; }
        }}
        Some((466, 466, frame, self.panel.pixels_written))
    }
    fn display_version(&self) -> u64 { self.panel.pixels_written }
    fn display_frames(&self) -> u64 { self.panel.frames }
    fn input_levels(&self) -> Vec<(u8, bool)> { vec![(11, self.irq_level)] }
    fn touch(&mut self, x: u16, y: u16, down: bool) { self.touch_at(self.cycle, x, y, down); }
    fn touch_at(&mut self, cycle: VirtualCycle, x: u16, y: u16, down: bool) {
        // BSP default mirrors both axes: convert viewer pixels to raw touch coordinates.
        let x = x.min(465); let y = y.min(465);
        let dx = 2 * i32::from(x) + 1 - 466; let dy = 2 * i32::from(y) + 1 - 466;
        if down && dx*dx + dy*dy > 466*466 { return; }
        let notify = {
            let mut state = self.touch.lock().expect("CST9217 touch lock");
            let report = Touch { x: 466-x, y: 466-y, down };
            state.current = report;
            if state.pending.len() == 64 { state.pending.pop_front(); }
            state.pending.push_back(report);
            if state.notified { false } else { state.notified = true; true }
        };
        // Each new report generates an active-low pulse, including release.
        if notify { self.queue_interrupt(cycle); }
    }
    fn next_deadline(&self) -> Option<VirtualCycle> {
        let needs_irq = { let s = self.touch.lock().expect("touch lock"); !s.notified && !s.pending.is_empty() };
        match (self.queued.front().map(|&(time, _)| time), needs_irq) {
            (Some(t), _) => Some(t), (None, true) => Some(self.cycle.saturating_add(1)), _ => None,
        }
    }
    fn advance_to(&mut self, cycle: VirtualCycle) {
        assert!(cycle >= self.cycle); self.cycle = cycle;
        while self.queued.front().is_some_and(|&(time, _)| time <= cycle) {
            let (time, level) = self.queued.pop_front().expect("due touch interrupt");
            self.irq_level = level;
            self.edges.push(BoardEdge { cycle: time, pin: 11, level });
        }
        let notify = { let mut s = self.touch.lock().expect("touch lock");
            if !s.notified && !s.pending.is_empty() { s.notified = true; true } else { false } };
        if notify { self.queue_interrupt(cycle); }
        self.imu.cycle.store(cycle, std::sync::atomic::Ordering::Relaxed);
    }
    fn take_edges(&mut self) -> Vec<BoardEdge> { std::mem::take(&mut self.edges) }
}

impl Waveshare175c {
    fn queue_interrupt(&mut self, cycle: VirtualCycle) {
        let earliest = cycle.max(self.cycle).saturating_add(1);
        let when = self.queued.back().map_or(earliest, |&(time, _)| earliest.max(time.saturating_add(1)));
        self.queued.push_back((when, false)); self.queued.push_back((when.saturating_add(1), true));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn board_exposes_only_175c_devices_and_466_square_frame() {
        let mut board = Waveshare175c::new();
        let devices: Vec<_> = board.i2c_devices().iter().map(|(bus, addr, _)| (*bus, *addr)).collect();
        assert!(devices.contains(&(0, 0x5a)));
        assert!(devices.contains(&(1, 0x5a)));
        assert!(devices.contains(&(0, 0x34)));
        assert!(!devices.contains(&(0, 0x51)));
        let (w, h, _, _) = board.display().unwrap();
        assert_eq!((w, h), (466, 466));
    }
    #[test]
    fn touch_reports_bsp_compatible_coordinates_and_release() {
        let mut board = Waveshare175c::new();
        board.touch(466 - 0x123, 466 - 0x145, true);
        let mut dev = board.i2c_devices().into_iter().find(|(_, addr, _)| *addr == 0x5a).unwrap().2;
        assert!(dev.start(false)); assert!(dev.write(0xd0)); assert!(dev.write(0x00)); assert!(dev.start(true));
        let data: Vec<_> = (0..10).map(|_| dev.read()).collect();
        assert_eq!((data[0] & 0x0f, data[1], data[2], data[3], data[5], data[6]), (6, 0x12, 0x14, 0x35, 1, 0xab));
        board.touch(0, 0, false);
        assert!(dev.start(false)); assert!(dev.write(0xd0)); assert!(dev.write(0)); assert!(dev.start(true));
        let released: Vec<_> = (0..10).map(|_| dev.read()).collect();
        assert_eq!((released[5], released[6]), (0, 0xab));
    }
    #[test]
    fn short_tap_remains_readable_until_reports_are_consumed() {
        let mut board = Waveshare175c::new();
        board.touch(233, 200, true);
        board.touch(233, 200, false);
        let mut device = board.i2c_devices().into_iter().find(|(bus, addr, _)| *bus == 1 && *addr == 0x5a).unwrap().2;
        let mut read_report = || {
            assert!(device.start(false)); assert!(device.write(0xd0)); assert!(device.write(0)); assert!(device.start(true));
            (0..10).map(|_| device.read()).collect::<Vec<_>>()
        };
        assert_eq!(read_report()[5], 1);
        assert_eq!(read_report()[5], 0);
    }
    #[test]
    fn short_tap_delivers_both_touch_interrupt_edges() {
        let mut board = Waveshare175c::new();
        board.touch(100, 120, true);
        board.touch(100, 120, false);
        board.advance_to(4);
        assert_eq!(board.take_edges(), vec![
            BoardEdge { cycle: 1, pin: 11, level: false },
            BoardEdge { cycle: 2, pin: 11, level: true },
        ]);
        let mut dev = board.i2c_devices().into_iter().find(|(_, addr, _)| *addr == 0x5a).unwrap().2;
        assert!(dev.start(false)); assert!(dev.write(0xd0)); assert!(dev.write(0)); assert!(dev.start(true));
        assert_eq!((0..10).map(|_| dev.read()).collect::<Vec<_>>()[5], 1);
        board.advance_to(5); board.advance_to(7);
        assert_eq!(board.take_edges(), vec![BoardEdge { cycle: 6, pin: 11, level: false }, BoardEdge { cycle: 7, pin: 11, level: true }]);
    }
    #[test]
    fn co5300_applies_six_pixel_column_offset() {
        let mut board = Waveshare175c::new();
        board.spi_transfer(2, &[0x02, 0, 0x2a, 0, 0, 6, 0, 6], 0);
        board.spi_transfer(2, &[0x02, 0, 0x2b, 0, 0, 0, 0, 0], 0);
        board.spi_transfer(2, &[0x32, 0, 0x2c, 0, 0xf8, 0x00], 0);
        let (_, _, frame, written) = board.display().unwrap();
        assert_eq!(board.panel.frame[0], 0xf800);
        assert_eq!(frame[0], 0); assert_eq!(written, 1);
    }
}
