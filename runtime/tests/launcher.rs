#[cfg(unix)]
#[test]
fn launches_repeatedly_and_reports_port_conflicts() {
    use std::{
        io::{BufRead, BufReader},
        net::TcpListener,
        process::{Command, Stdio},
        thread,
        time::Duration,
    };
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(root.path().join("apps/desktop/dist")).unwrap();
    std::fs::write(root.path().join("apps/desktop/dist/index.html"), "test").unwrap();
    let occupied = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = occupied.local_addr().unwrap().port().to_string();
    let failed = Command::new(env!("CARGO_BIN_EXE_amoled-studio"))
        .args(["serve", "--project"])
        .arg(root.path())
        .args(["--port", &port])
        .output()
        .unwrap();
    assert!(!failed.status.success());
    drop(occupied);
    for _ in 0..2 {
        let mut child = Command::new(env!("CARGO_BIN_EXE_amoled-studio"))
            .args(["serve", "--project"])
            .arg(root.path())
            .args(["--port", &port])
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let mut line = String::new();
        BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        assert!(line.contains("#bootstrap="));
        assert!(Command::new("kill")
            .args(["-TERM", &child.id().to_string()])
            .status()
            .unwrap()
            .success());
        assert!(child.wait().unwrap().success());
        thread::sleep(Duration::from_millis(50));
        assert!(TcpListener::bind(format!("127.0.0.1:{port}")).is_ok());
    }
}
