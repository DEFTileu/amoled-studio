#!/usr/bin/env python3
"""Opt-in bearer protection for the internal esp32sim loopback listener."""
import pathlib
import sys
p = pathlib.Path(sys.argv[1])
s = p.read_text()
needle = '    let key = header(&text, "Sec-WebSocket-Key").map(str::to_string);\n'
patch = '''    // AMOLED Studio private transport: disabled unless the supervisor sets a secret.
    if let Ok(secret) = std::env::var("AMOLED_ESP32SIM_TOKEN") {
        let expected = format!("Bearer {secret}");
        if header(&text, "Authorization") != Some(expected.as_str()) {
            let _ = http_response(&mut stream, "401 Unauthorized", "text/plain", b"unauthorized");
            return;
        }
    }
'''
if patch not in s:
    if needle not in s:
        raise SystemExit('esp32sim web handler format changed; refusing to patch')
    p.write_text(s.replace(needle, patch + needle, 1))
