param([ValidateSet('setup','dev','migrate','seed','test','smoke','reset-demo','integration','compose-check')][string]$Task = 'dev', [string]$Target = 'web', [string]$Tenant = '', [string]$Confirm = '')
$ErrorActionPreference = 'Stop'
python (Join-Path $PSScriptRoot 'task.py') $Task $Target --tenant $Tenant --confirm $Confirm
exit $LASTEXITCODE
