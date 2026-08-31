import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'public/index.html'),
        admin: resolve(__dirname, 'public/admin.html'),
        auth: resolve(__dirname, 'public/auth.html'),
        products: resolve(__dirname, 'public/products.html'),
        checkout: resolve(__dirname, 'public/checkout.html'),
        myOrders: resolve(__dirname, 'public/my-orders.html'),
        productDetail: resolve(__dirname, 'public/product-detail.html'),
        profile: resolve(__dirname, 'public/profile.html'),
        wishlist: resolve(__dirname, 'public/wishlist.html'),
        app: resolve(__dirname, 'public/app.js'),
        adminLogin: resolve(__dirname, 'public/admin-login.html'),
        invoice: resolve(__dirname, 'public/invoice.html'),
        videoDisplay: resolve(__dirname, 'public/video-display.html'),
        videoUpload: resolve(__dirname, 'public/video-upload.html'),
        error404: resolve(__dirname, 'public/404.html')
      },
      output: {
        entryFileNames: '[name].[hash].js',
        chunkFileNames: '[name].[hash].js',
        assetFileNames: '[name].[hash].[ext]'
      }
    }
  }
});
