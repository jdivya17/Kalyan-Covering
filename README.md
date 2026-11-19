# Kalyan Covering Store

E-commerce platform for Kalyan Covering Jewellers, featuring gold-covering jewellery, real-time inventory management, Razorpay payment processing, and automated Shiprocket logistics.

---

## Shiprocket Logistics Integration

### Environment Variables (Names Only)
Set these in your local `.env` (git-ignored) and in Vercel project environment settings:

| Variable Name | Purpose | Required / Default |
| :--- | :--- | :--- |
| `SHIPROCKET_EMAIL` | Shiprocket dedicated API user email | Required |
| `SHIPROCKET_PASSWORD` | Shiprocket dedicated API user password | Required |
| `SHIPROCKET_PICKUP_LOCATION` | Exact pickup location name in Shiprocket | Required (Fallback: `STORE_PICKUP_LOCATION`) |
| `SHIPROCKET_PICKUP_PINCODE` | Origin pickup postal code | Required (Fallback: `STORE_PICKUP_PINCODE`) |
| `SHIPROCKET_WEBHOOK_TOKEN` | Webhook verification token | Required |
| `SHIPROCKET_DEFAULT_WEIGHT_KG` | Fallback parcel weight in kilograms | Optional (Default: `0.3`) |
| `SHIPROCKET_DEFAULT_LENGTH` | Fallback parcel length in cm | Optional (Default: `15`) |
| `SHIPROCKET_DEFAULT_BREADTH` | Fallback parcel breadth in cm | Optional (Default: `12`) |
| `SHIPROCKET_DEFAULT_HEIGHT` | Fallback parcel height in cm | Optional (Default: `10`) |

*Note: Surrounding quotes and whitespace are automatically sanitized.*

### Webhook Configuration
In your Shiprocket Dashboard (**Settings > API > Webhooks**):
- **Webhook URL:** `https://<YOUR_DOMAIN>/api/shipping/webhook`
- **Header:** `x-api-key` containing the exact value set in `SHIPROCKET_WEBHOOK_TOKEN`
- **Events:** Order status updates (Pickup scheduled, Dispatched / In Transit, Out for Delivery, Delivered, RTO / Return, Cancelled)

### Safe Local Diagnostic CLI
A dedicated read-only test script is available to verify connectivity, pickup location matching, and serviceability without placing test orders or generating AWBs:

```bash
# Verify login credentials and check that SHIPROCKET_PICKUP_LOCATION matches Shiprocket exactly:
npm run check:shiprocket

# Verify serviceability for a delivery pincode:
npm run check:shiprocket 600001
```
