import { callVercelApi } from '../firebase-config.js';

export async function uploadToCloudinary(file, resourceType = 'auto') {
    if (!file) return null;
    
    // Max size validations: 50MB for video, 5MB for review image, 10MB for product image
    const maxVideoSize = 50 * 1024 * 1024;
    const maxReviewImageSize = 5 * 1024 * 1024;
    const maxImageSize = 10 * 1024 * 1024;
    const isVideo = resourceType === 'video';
    const isReview = resourceType === 'review';

    if (isReview && (!file.type || !file.type.startsWith('image/'))) {
        const msg = 'Review attachments must be image files.';
        if (typeof window.Toast !== 'undefined') window.Toast.error('Invalid File Type', msg);
        throw new Error(msg);
    }

    if (isVideo && file.size > maxVideoSize) {
        const msg = 'Video file size exceeds maximum limit of 50MB. Please choose a smaller video.';
        if (typeof window.Toast !== 'undefined') window.Toast.error('File Too Large', msg);
        throw new Error(msg);
    }
    if (isReview && file.size > maxReviewImageSize) {
        const msg = 'Review image size exceeds maximum limit of 5MB.';
        if (typeof window.Toast !== 'undefined') window.Toast.error('File Too Large', msg);
        throw new Error(msg);
    }
    if (!isVideo && !isReview && file.size > maxImageSize) {
        const msg = 'Image file size exceeds maximum limit of 10MB.';
        if (typeof window.Toast !== 'undefined') window.Toast.error('File Too Large', msg);
        throw new Error(msg);
    }

    // Obtain signed authorization from server
    let signFn = callVercelApi;
    if (typeof signFn !== 'function' && typeof window.callVercelApi === 'function') {
        signFn = window.callVercelApi;
    }

    const uploadType = isReview ? 'review' : (isVideo ? 'product_video' : 'product_image');
    const signData = await signFn('/api/uploads/sign', { uploadType });

    if (!signData || !signData.signature) {
        throw new Error('Failed to obtain Cloudinary upload authorization signature.');
    }

    const endpointResourceType = isVideo ? 'video' : 'image';
    const formData = new FormData();
    formData.append('file', file);
    formData.append('api_key', signData.api_key);
    formData.append('timestamp', signData.timestamp);
    formData.append('signature', signData.signature);
    formData.append('folder', signData.folder);
    if (signData.allowed_formats) {
        formData.append('allowed_formats', signData.allowed_formats);
    }

    try {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `https://api.cloudinary.com/v1_1/${signData.cloud_name}/${endpointResourceType}/upload`);

        return new Promise((resolve, reject) => {
            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                    const progress = (event.loaded / event.total) * 100;
                    if (typeof window.updateUploadProgress === 'function') {
                        window.updateUploadProgress(progress, endpointResourceType);
                    }
                }
            };

            xhr.onload = () => {
                if (xhr.status === 200) {
                    const response = JSON.parse(xhr.responseText);
                    resolve({ url: response.secure_url, publicId: response.public_id });
                } else {
                    let errMsg = `Upload failed with status ${xhr.status}`;
                    try {
                        const errRes = JSON.parse(xhr.responseText);
                        if (errRes.error?.message) {
                            errMsg = errRes.error.message;
                        }
                    } catch (_) {}
                    if (typeof window.Toast !== 'undefined') window.Toast.error('Upload Failed', errMsg);
                    reject(new Error(errMsg));
                }
            };
            xhr.onerror = () => {
                const errMsg = 'Network error during Cloudinary upload. Please check your connection.';
                if (typeof window.Toast !== 'undefined') window.Toast.error('Upload Error', errMsg);
                reject(new Error(errMsg));
            };
            xhr.send(formData);
        });
    } catch (e) {
        console.error('Exception during Cloudinary upload:', e);
        if (typeof window.Toast !== 'undefined') window.Toast.error('Upload Error', e.message || 'Upload failed');
        throw e;
    }
}

export function getOptimizedUrl(url, width = 800) {
    try {
        if (!url) return url;
        if (url.includes('res.cloudinary.com') || url.includes('cloudinary.com')) {
            return url.replace('/upload/', `/upload/f_auto,q_auto,w_${width}/`);
        }
        return url;
    } catch {
        return url;
    }
}

// Bind to window for legacy support
window.uploadToCloudinary = uploadToCloudinary;
window.uploadImageToCloudinary = (file) => uploadToCloudinary(file, 'image');
window.uploadReviewPhotoToCloudinary = (file) => uploadToCloudinary(file, 'review');
window.uploadVideoToCloudinary = (file) => uploadToCloudinary(file, 'video');
window.getOptimizedUrl = getOptimizedUrl;
