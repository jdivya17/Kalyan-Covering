// ---- Cloudinary Config ----
const CLOUDINARY_CLOUD_NAME = 'ddw2whxh7';
const CLOUDINARY_UPLOAD_PRESET = 'kalyan_covering_upload';

export async function uploadToCloudinary(file, resourceType = 'auto') {
    if (!file) return null;
    
    // Max size validations: 50MB for video, 10MB for image/other
    const maxVideoSize = 50 * 1024 * 1024;
    const maxImageSize = 10 * 1024 * 1024;
    if (resourceType === 'video' && file.size > maxVideoSize) {
        const msg = 'Video file size exceeds maximum limit of 50MB. Please choose a smaller video.';
        if (typeof window.Toast !== 'undefined') window.Toast.error('File Too Large', msg);
        throw new Error(msg);
    }
    if (resourceType !== 'video' && file.size > maxImageSize) {
        const msg = 'Image file size exceeds maximum limit of 10MB.';
        if (typeof window.Toast !== 'undefined') window.Toast.error('File Too Large', msg);
        throw new Error(msg);
    }

    if (!CLOUDINARY_CLOUD_NAME) {
        console.error('Cloudinary credentials missing!');
        return null;
    }

    const preset = resourceType === 'video' ? 'kalyan_videos' : CLOUDINARY_UPLOAD_PRESET;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', preset);

    try {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`);

        return new Promise((resolve, reject) => {
            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                    const progress = (event.loaded / event.total) * 100;
                    if (typeof window.updateUploadProgress === 'function') window.updateUploadProgress(progress, resourceType === 'video' ? 'video' : 'image');
                }
            };

            xhr.onload = () => {
                if (xhr.status === 200) {
                    const response = JSON.parse(xhr.responseText);
                    resolve({ url: response.secure_url, publicId: response.public_id });
                } else {
                    reject(new Error(`Cloudinary failed with ${xhr.status}`));
                }
            };
            xhr.onerror = () => reject(new Error('Network error during Cloudinary upload'));
            xhr.send(formData);
        });
    } catch (e) {
        console.error('Exception during Cloudinary upload:', e);
        return null;
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
window.uploadVideoToCloudinary = (file) => uploadToCloudinary(file, 'video');
window.getOptimizedUrl = getOptimizedUrl;
