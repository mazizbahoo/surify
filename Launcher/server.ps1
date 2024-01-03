# Tiny local web server for the Surify app (Windows, no install needed).
# Serves http://localhost:8765/, opens the default browser
# and exits once the page has been closed.
$ErrorActionPreference = 'Stop'
$root   = Split-Path -Parent $PSScriptRoot
$parent = Split-Path -Parent $root
$port   = 8765
$url    = "http://localhost:$port/"
$idle   = 120

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
try { $listener.Start() } catch { Start-Process $url; exit }
Start-Process $url

$mime = @{
    '.html'='text/html; charset=utf-8'; '.css'='text/css'; '.js'='application/javascript'
    '.json'='application/json'; '.svg'='image/svg+xml'; '.ico'='image/x-icon'
    '.png'='image/png'; '.jpg'='image/jpeg'; '.jpeg'='image/jpeg'; '.webp'='image/webp'
    '.gif'='image/gif'; '.mp3'='audio/mpeg'; '.woff2'='font/woff2'; '.woff'='font/woff'
}

function Send-Text($res, $code, $text, $type) {
    $bytes = [Text.Encoding]::UTF8.GetBytes($text)
    $res.StatusCode = $code; $res.ContentType = $type
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
}

$last = Get-Date
$task = $listener.GetContextAsync()
while ($true) {
    if (-not $task.Wait(5000)) {
        if (((Get-Date) - $last).TotalSeconds -gt $idle) { break }
        continue
    }
    $ctx  = $task.Result
    $task = $listener.GetContextAsync()
    $res  = $ctx.Response
    try {
        $res.Headers.Add('Cache-Control', 'no-cache')
        $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)

        if ($path.EndsWith('/__ping')) { $last = Get-Date; $res.StatusCode = 204; continue }

        if ($path -eq '/' -or $path -eq '') { $path = '/App/index.html' }
        $rel  = $path.TrimStart('/').Replace('/', '\')
        $full = [IO.Path]::GetFullPath((Join-Path $root $rel))
        if (-not (Test-Path -LiteralPath $full) -and $rel -like 'Audios*') {
            $alt = [IO.Path]::GetFullPath((Join-Path $parent $rel))
            if (Test-Path -LiteralPath $alt) { $full = $alt }
        }
        $inRoot = $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or
                  $full.StartsWith((Join-Path $parent 'Audios'), [StringComparison]::OrdinalIgnoreCase)
        if (-not $inRoot -or -not (Test-Path -LiteralPath $full)) {
            Send-Text $res 404 'Not found' 'text/plain'; continue
        }

        if (Test-Path -LiteralPath $full -PathType Container) {
            if (-not $path.EndsWith('/')) { $res.Redirect("$path/"); continue }
            $index = Join-Path $full 'index.html'
            if (Test-Path -LiteralPath $index) { $full = $index }
            else {
                $links = Get-ChildItem -LiteralPath $full | ForEach-Object {
                    $n = [Uri]::EscapeDataString($_.Name)
                    if ($_.PSIsContainer) { $n += '/' }
                    $label = [Net.WebUtility]::HtmlEncode($_.Name)
                    "<li><a href=`"$n`">$label</a></li>"
                }
                Send-Text $res 200 ("<!DOCTYPE html><html><body><ul>" + ($links -join '') + "</ul></body></html>") 'text/html; charset=utf-8'
                continue
            }
        }

        $ext = [IO.Path]::GetExtension($full).ToLower()
        $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
        $bytes = [IO.File]::ReadAllBytes($full)
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch { }
    finally { try { $res.Close() } catch { } }
}
$listener.Stop()
