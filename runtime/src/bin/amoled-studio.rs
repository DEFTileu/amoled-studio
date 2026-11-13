use amoled_runtime::http_api::{generate_token, ApiConfig, ApiServer};
use std::{path::PathBuf, process::Command};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() != Some("serve") {
        return Err("usage: amoled-studio serve [--open] [--port PORT] [--project PATH]".into());
    }
    let mut root = std::env::current_dir()?;
    let mut port = 0;
    let mut open = false;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--open" => open = true,
            "--port" => port = args.next().ok_or("--port requires a number")?.parse()?,
            "--project" => root = PathBuf::from(args.next().ok_or("--project requires a path")?),
            _ => return Err(format!("unknown argument: {arg}").into()),
        }
    }
    let nonce = generate_token()?;
    let config = ApiConfig::new(root.clone(), vec![], generate_token()?)?
        .with_frontend(root.join("apps/desktop/dist"), nonce.clone())?
        .with_port(port);
    let server = ApiServer::start(config).await?;
    let url = format!("http://{}/#bootstrap={nonce}", server.address());
    #[cfg(unix)]
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    if open {
        #[cfg(target_os = "macos")]
        let result = Command::new("open").arg(&url).status();
        #[cfg(not(target_os = "macos"))]
        let result = Command::new("xdg-open").arg(&url).status();
        match result {
            Ok(status) if status.success() => (),
            _ => {
                server.shutdown().await?;
                return Err("could not open the default browser".into());
            }
        }
        println!("AMOLED Studio listening on http://{}", server.address());
    } else {
        println!("Open this one-time launch URL in your browser: {url}");
    }
    #[cfg(unix)]
    {
        tokio::select! { r = tokio::signal::ctrl_c() => r?, _ = terminate.recv() => {} }
    }
    #[cfg(not(unix))]
    tokio::signal::ctrl_c().await?;
    server.shutdown().await?;
    Ok(())
}
