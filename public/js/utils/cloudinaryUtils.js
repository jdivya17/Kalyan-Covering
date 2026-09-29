// ---- Cloudinary Config ----
export const CLOUDINARY = {
    cloudName: 'ddw2whxh7',
    defaultPreset: 'kalyan_covering_upload',
    reviewPreset: 'kalyan_reviews',
    videoPreset: 'kalyan_videos'
};

export async function uploadToCloudinary(file, resourceType = 'auto', customPreset = null) {
    if (!file) return null;
    
    // Max size validations: 50MB for video, 10MB for image/other
    const maxVideoSize = 50 * 1024 * 1024;
    const maxImageSize = 10 * 1024 * 1024;
    const isVideo = resourceType === 'video';

    if (isVideo && file.size > maxVideoSize) {
        const msg = 'Video file size exceeds maximum limit of 50MB. Please choose a smaller video.';
        if (typeof window.Toast !== 'undefined') window.Toast.error('File Too Large', msg);
        throw new Error(msg);
    }
    if (!isVideo && file.size > maxImageSize) {
        const msg = 'Image file size exceeds maximum limit of 10MB.';
        if (typeof window.Toast !== 'undefined') window.Toast.error('File Too Large', msg);
        throw new Error(msg);
    }

    let preset = customPreset;
    if (!preset) {
        if (resourceType === 'review') preset = CLOUDINARY.reviewPreset;
        else if (resourceType === 'video') preset = CLOUDINARY.videoPreset;
        else preset = CLOUDINARY.defaultPreset;
    }

    const endpointResourceType = isVideo ? 'video' : 'image';
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', preset);

    try {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUDINARY.cloudName}/${endpointResourceType}/upload`);

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
                            if (errRes.error.message.toLowerCase().includes('preset')) {
                                errMsg = `Cloudinary preset "${preset}" is missing or not configured as Unsigned.`;
                            } else {
                                errMsg = errRes.error.message;
                            }
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
window.CLOUDINARY = CLOUDINARY;
window.uploadToCloudinary = uploadToCloudinary;
window.uploadImageToCloudinary = (file) => uploadToCloudinary(file, 'image');
window.uploadReviewPhotoToCloudinary = (file) => uploadToCloudinary(file, 'review');
window.uploadVideoToCloudinary = (file) => uploadToCloudinary(file, 'video');
window.getOptimizedUrl = getOptimizedUrl;
