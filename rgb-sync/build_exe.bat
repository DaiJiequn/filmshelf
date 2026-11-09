@echo off
REM 打包为单文件 exe（需要先 pip install pyinstaller hidapi）
pyinstaller --noconfirm --onefile --windowed --name RGBSync --uac-admin run_gui.py
echo 输出在 dist\RGBSync.exe
