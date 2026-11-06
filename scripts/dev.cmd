@echo off
setlocal
rem Inject MSVC / Windows SDK env (vcvars64.bat is broken on this machine)
set "VSDIR=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools"
set "MSVCVER=14.44.35207"
set "SDKVER=10.0.26100.0"
set "KITS=C:\Program Files (x86)\Windows Kits\10"

set "PATH=%VSDIR%\VC\Tools\MSVC\%MSVCVER%\bin\Hostx64\x64;%USERPROFILE%\.cargo\bin;%PATH%"
set "LIB=%VSDIR%\VC\Tools\MSVC\%MSVCVER%\lib\x64;%KITS%\Lib\%SDKVER%\um\x64;%KITS%\Lib\%SDKVER%\ucrt\x64"
set "INCLUDE=%VSDIR%\VC\Tools\MSVC\%MSVCVER%\include;%KITS%\Include\%SDKVER%\ucrt;%KITS%\Include\%SDKVER%\um;%KITS%\Include\%SDKVER%\shared"

cd /d "%~dp0.."
echo === tauri dev start %TIME% ===
npm run tauri dev
