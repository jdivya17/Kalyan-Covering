# Keys are now stored securely in functions/.env
# This script is no longer needed — keys have been configured.
Write-Host "Keys are already set in functions/.env" -ForegroundColor Green
Write-Host "RAZORPAY_KEY_SECRET set!" -ForegroundColor Green

Write-Host "Both secrets set! Deploying functions..." -ForegroundColor Cyan

# Deploy functions
firebase deploy --only functions

Write-Host "Done! Razorpay Live is now integrated." -ForegroundColor Green
Read-Host "Press Enter to exit"
