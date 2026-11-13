use amoled_runtime::http_api::{generate_token, ApiConfig, ApiServer};
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
use std::{fs::OpenOptions, io::Write, path::PathBuf};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut root = std::env::current_dir()?;
    let mut origins = Vec::new();
    let mut port = 0u16;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--project" => root = PathBuf::from(args.next().ok_or("--project requires a path")?),
            "--allow-origin" => origins.push(
                args.next()
                    .ok_or("--allow-origin requires an exact origin")?,
            ),
            "--port" => port = args.next().ok_or("--port requires a number")?.parse()?,
            _ => return Err(format!("unknown argument: {arg}").into()),
        }
    }
    let token = generate_token()?;
    let directory = tempfile::Builder::new()
        .prefix("amoled-api-token-")
        .tempdir()?;
    let token_path = directory.path().join("token");
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options.open(&token_path)?;
    file.write_all(token.as_bytes())?;
    let server = ApiServer::start(ApiConfig::new(root, origins, token)?.with_port(port)).await?;
    #[cfg(unix)]
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    println!(
        "{}",
        serde_json::json!({"api_version":1,"address":format!("http://{}",server.address()),"token_file":token_path})
    );
    #[cfg(unix)]
    {
        tokio::select! { result = tokio::signal::ctrl_c() => result?, _ = terminate.recv() => {} }
    }
    #[cfg(not(unix))]
    tokio::signal::ctrl_c().await?;
    server.shutdown().await?;
    drop(directory);
    Ok(())
}
