import { defineConfig } from 'vite';
import { resolve } from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

function apiMiddleware() {
  return {
    name: 'api-middleware',
    configureServer(server) {
      try {
        const apiApp = require('./api/index.js');
        server.middlewares.use(apiApp);
      } catch (err) {
        console.warn('Could not load api/index.js in Vite middleware:', err.message);
      }
    }
  };
}

export default defineConfig({
  plugins: [apiMiddleware()],
  root: 'public',
  server: {
    port: 5173
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'public/index.html'),
        customerIndex: resolve(__dirname, 'public/customer/index.html'),
        customerProducts: resolve(__dirname, 'public/customer/products.html'),
        customerProductDetail: resolve(__dirname, 'public/customer/product-detail.html'),
        customerCart: resolve(__dirname, 'public/customer/cart.html'),
        customerWishlist: resolve(__dirname, 'public/customer/wishlist.html'),
        customerAuth: resolve(__dirname, 'public/customer/auth.html'),
        customerCheckout: resolve(__dirname, 'public/customer/checkout.html'),
        customerOrderSuccess: resolve(__dirname, 'public/customer/order-success.html'),
        customerMyOrders: resolve(__dirname, 'public/customer/my-orders.html'),
        customerOrderDetails: resolve(__dirname, 'public/customer/order-details.html'),
        customerInvoice: resolve(__dirname, 'public/customer/invoice.html'),
        customerProfile: resolve(__dirname, 'public/customer/profile.html'),

        
        adminLogin: resolve(__dirname, 'public/admin/admin-login.html'),
        adminDashboard: resolve(__dirname, 'public/admin/dashboard.html'),


        videoDisplay: resolve(__dirname, 'public/video-display.html'),
        videoUpload: resolve(__dirname, 'public/video-upload.html'),
        error404: resolve(__dirname, 'public/404.html')
      },
      output: {
        entryFileNames: 'js/[name].js',
        chunkFileNames: 'js/[name].js',
        assetFileNames: 'assets/[name].[ext]'
      }
    }
  }
});
