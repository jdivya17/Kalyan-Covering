@echo off
echo Starting Firebase Functions deployment...
npx firebase-tools deploy --only functions
pause
