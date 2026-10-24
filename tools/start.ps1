# 座席管理アプリ（Spring Boot 版）を起動する。start.bat から呼ばれる。
#   start.bat           ... 起動（初めてなら、必要なものを自動で用意する）
#   start.bat rebuild   ... プログラムを直した後に、作り直してから起動する
# 環境変数（任意）:
#   PORT=8081                  ポート番号（このPCの既定は server\config\application.yml の 8081）
#   SEAT_ADMIN_PASSWORD=...    管理者(admin)のパスワード。未指定なら、初回の起動時に乱数で作ってこの画面に1回だけ表示する
#   NO_BROWSER=1               ブラウザを自動で開かない
#   DB_URL / DB_USER / DB_PASSWORD   データベースの接続先（server\config\application.yml があればそちらが優先）
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
# ポート：環境変数 PORT → このPCの設定ファイル（server\config\application.yml の server.port）→ 8080 の順に決める
$cfgFile = Join-Path $root 'server\config\application.yml'
$port = $env:PORT
if (-not $port -and (Test-Path $cfgFile)) {
  $m = Select-String -Path $cfgFile -Pattern '^\s*port:\s*(?:\$\{PORT:)?(\d+)' | Select-Object -First 1
  if ($m) { $port = $m.Matches[0].Groups[1].Value }
}
if (-not $port) { $port = '8080' }
$mvn = Join-Path $root 'tools\maven\bin\mvn.cmd'
$jar = Join-Path $root 'server\target\seat-app-0.1.0.jar'

function Stop-WithMessage($text) {
  Write-Host $text -ForegroundColor Red
  exit 1
}

# --- Java ---
if (-not (Get-Command java -ErrorAction SilentlyContinue)) { Stop-WithMessage 'Java が見つかりません。Java 21 以上を入れてください。' }

# --- ポート（以前のテスト版サーバーなどが使っていないか） ---
if (Get-NetTCPConnection -LocalPort ([int]$port) -State Listen -ErrorAction SilentlyContinue) {
  Write-Host "ポート $port は、ほかのプログラムが使っています。" -ForegroundColor Red
  Write-Host '以前のテスト版サーバー（start-simple.bat）が動いたままかもしれません。止めるか、別の番号で起動してください。'
  Write-Host '  例（別の番号）:  $env:PORT = 8081 ; .\start.bat'
  exit 1
}

# --- データベース（server\config\application.yml で PostgreSQL を指定していれば、そのサービスが動いているか確認する） ---
$localCfg = Join-Path $root 'server\config\application.yml'
if ((Test-Path $localCfg) -and (Select-String -Path $localCfg -Pattern 'postgresql' -Quiet)) {
  $svc = Get-Service 'postgresql*' -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $svc) { Stop-WithMessage 'PostgreSQL のサービスが見つかりません。インストールされているか確認してください。' }
  if ($svc.Status -ne 'Running') { Stop-WithMessage "PostgreSQL（$($svc.Name)）が止まっています。Windows の「サービス」から開始してください。" }
  Write-Host "データベース: PostgreSQL（サービス $($svc.Name)）"
} else {
  Write-Host 'データベース: H2（server\data のファイル）'
}

# --- 持ち運び版の Maven（無ければ Maven Central から取得。PC全体へはインストールしない） ---
if (-not (Test-Path $mvn)) {
  Write-Host 'Maven を取得します（初回だけ）...'
  $zip = Join-Path $env:TEMP 'apache-maven-bin.zip'
  $tmp = Join-Path $env:TEMP 'maven-extract'
  Invoke-WebRequest -Uri 'https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/3.9.11/apache-maven-3.9.11-bin.zip' -OutFile $zip -UseBasicParsing
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $tmp
  New-Item -ItemType Directory -Force (Join-Path $root 'tools\maven') | Out-Null
  Copy-Item -Path (Join-Path $tmp 'apache-maven-3.9.11\*') -Destination (Join-Path $root 'tools\maven') -Recurse -Force
  Remove-Item $tmp -Recurse -Force; Remove-Item $zip -Force
  if (-not (Test-Path $mvn)) { Stop-WithMessage 'Maven を取得できませんでした。インターネットに接続できるか確認してください。' }
}

# --- プログラムの作成（無い時、または rebuild の指定がある時） ---
$rebuild = ($args -contains 'rebuild')
if ($rebuild -or -not (Test-Path $jar)) {
  Write-Host 'プログラムを作ります（初回は部品の取得で数分かかります）...'
  # 会社などの証明書が Java に入っていなくても Maven が接続できるよう、Windows の証明書を使う（検証は切らない）
  $env:MAVEN_OPTS = '-Djavax.net.ssl.trustStoreType=Windows-ROOT -Djavax.net.ssl.trustStore=NONE --sun-misc-unsafe-memory-access=allow'
  & $mvn -q -B -DskipTests -f (Join-Path $root 'server\pom.xml') package
  if ($LASTEXITCODE -ne 0) {
    Stop-WithMessage '作成に失敗しました。上のメッセージを確認してください（起動中のサーバーがあれば、止めてからやり直してください）。'
  }
}

# --- 起動 ---
if ($env:NO_BROWSER -ne '1') {
  Start-Process -WindowStyle Hidden -FilePath 'powershell' -ArgumentList '-NoProfile', '-Command', "Start-Sleep -Seconds 9; Start-Process 'http://localhost:$port'"
}
Write-Host ''
Write-Host '起動します。止めるときは、この画面で Ctrl+C を押すか、画面を閉じてください。'
Write-Host '初めて起動したときは、管理者のパスワードが、この画面に1回だけ表示されます。'
Write-Host ''
$env:PORT = $port
Set-Location (Join-Path $root 'server')
& java -jar $jar
