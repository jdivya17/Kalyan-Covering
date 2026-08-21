Write-Host "Starting Firebase Functions deployment..." -ForegroundColor Green
npx firebase-tools deploy --only functions
Write-Host "Deployment finished." -ForegroundColor Cyan
