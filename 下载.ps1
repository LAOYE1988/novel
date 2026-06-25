cd $PSScriptRoot

Write-Host "`n  =======================================" -ForegroundColor Cyan
Write-Host "  正在从 GIT 仓库下载最新代码..." -ForegroundColor Cyan
Write-Host "  =======================================`n" -ForegroundColor Cyan

$stashed = $false
$hasChanges = (git status --porcelain) -ne ""
if ($hasChanges) {
    Write-Host "  检测到本地有未提交的修改，暂存中..." -ForegroundColor Yellow
    git stash push -m "自动暂存 $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    $stashed = $true
}

git pull --ff-only
if ($LASTEXITCODE -ne 0) {
    Write-Host "  快进合并失败，尝试自动合并..." -ForegroundColor Yellow
    git pull
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  下载失败，请手动处理冲突" -ForegroundColor Red
        exit 1
    }
}

if ($stashed) {
    Write-Host "  正在恢复本地暂存的修改..." -ForegroundColor Yellow
    git stash pop
}

Write-Host "`n  下载完成！本地代码已与 Gitee 同步`n" -ForegroundColor Green
exit 0
