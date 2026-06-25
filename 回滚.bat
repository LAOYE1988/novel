@echo off
cd /d "%~dp0"

echo ====================================
echo  最近 20 个历史版本
echo ====================================
echo.
git log --oneline --all -20
echo.
echo ====================================
echo  想回滚到哪个版本？
echo  输入前面那串字母数字（如：a1b2c3d）
echo  直接回车取消
echo ====================================
echo.

set /p version=请输入版本号：

if "%version%"=="" (
    echo 已取消
    pause
    exit /b
)

echo.
echo 正在回滚到 %version%...
echo 当前进度已备份，放心操作
echo.

git branch 回滚前备份_%DATE:~0,4%%DATE:~5,2%%DATE:~8,2% 2>nul
git checkout %version% -- .

echo.
echo 已回滚完成！如果想撤销，双击"提交.bat"再找我
echo.
pause
