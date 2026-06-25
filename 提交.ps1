param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$提交说明
)

cd $PSScriptRoot

$date = Get-Date -Format "yyyy-MM-dd HH:mm"
$msg = "$提交说明 ($date)"

Write-Host "`n  =======================================" -ForegroundColor Cyan
Write-Host "  正在提交到 GIT 仓库..." -ForegroundColor Cyan
Write-Host "  提交说明: $msg" -ForegroundColor Yellow
Write-Host "  =======================================`n" -ForegroundColor Cyan

git add .
if ($LASTEXITCODE -ne 0) { Write-Host "  失败: git add 出错" -ForegroundColor Red; exit 1 }

git commit -m "$msg"
if ($LASTEXITCODE -ne 0) { Write-Host "  失败: git commit 出错" -ForegroundColor Red; exit 1 }

git push origin master
if ($LASTEXITCODE -ne 0) { Write-Host "  失败: git push 出错" -ForegroundColor Red; exit 1 }

Write-Host "`n  提交成功！已安全推送到远程仓库`n" -ForegroundColor Green
