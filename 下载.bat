@echo off
cd /d "%~dp0"

echo ====================================
echo  正在从 GitHub 下载最新文件
echo  （只下载，不上传）
echo ====================================
echo.

git pull --ff-only

if errorlevel 1 (
    echo.
    echo 下载失败，可能原因：
    echo  - 你本地有改动和远程冲突了
    echo  - 先双击"提交.bat"上传本地文件再试
    echo  - 网络不通
) else (
    echo.
    echo 下载完成！
)

echo.
pause
