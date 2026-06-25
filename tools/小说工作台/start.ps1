$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')
$serverPy = Join-Path 'd:\trae_projects\novel\tools\小说工作台' 'server.py'
python $serverPy
