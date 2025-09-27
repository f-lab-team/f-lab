/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState, ChangeEvent, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactCrop, { type Crop, type PixelCrop, centerCrop, makeAspectCrop } from 'react-image-crop';
import { generateVibeBasedImage } from './services/geminiService';
import PhotoCard from './components/PhotoCard';
import { createAlbumPage } from './lib/albumUtils';
import Footer from './components/Footer';

const MAX_MAIN_IMAGES = 10;
const MAX_INSPIRATION_IMAGES = 5;

type ImageStatus = 'pending' | 'done' | 'error';
interface GeneratedImage {
    status: ImageStatus;
    url?: string;
    error?: string;
}

// Helper for image cropping
function canvasPreview(
    image: HTMLImageElement,
    canvas: HTMLCanvasElement,
    crop: PixelCrop
) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2d context');

    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;
    const pixelRatio = window.devicePixelRatio;

    canvas.width = Math.floor(crop.width * scaleX * pixelRatio);
    canvas.height = Math.floor(crop.height * scaleY * pixelRatio);

    ctx.scale(pixelRatio, pixelRatio);
    ctx.imageSmoothingQuality = 'high';

    const cropX = crop.x * scaleX;
    const cropY = crop.y * scaleY;

    ctx.save();
    ctx.translate(-cropX, -cropY);
    ctx.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight, 0, 0, image.naturalWidth, image.naturalHeight);
    ctx.restore();
}

const primaryButtonClasses = "text-lg font-semibold text-center text-white bg-orange-500 py-3 px-8 rounded-full transform transition-transform duration-200 hover:scale-105 hover:bg-orange-600 shadow-lg disabled:bg-neutral-400 disabled:cursor-not-allowed disabled:scale-100";
const secondaryButtonClasses = "text-lg font-semibold text-center text-white bg-white/10 backdrop-blur-sm border-2 border-white/80 py-3 px-8 rounded-full transform transition-transform duration-200 hover:scale-105 hover:bg-white hover:text-black";
const fileInputButtonClasses = "text-base font-semibold text-center text-white bg-white/20 backdrop-blur-sm border-2 border-white/60 py-2 px-5 rounded-full transform transition-transform duration-200 hover:scale-105 hover:bg-white hover:text-black cursor-pointer";

function App() {
    const [uploadedImages, setUploadedImages] = useState<string[]>([]);
    const [inspirationImages, setInspirationImages] = useState<string[]>([]);
    const [userPrompt, setUserPrompt] = useState<string>('');
    const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
    const [isDownloading, setIsDownloading] = useState<boolean>(false);
    const [appState, setAppState] = useState<'idle' | 'photos-uploaded' | 'generating' | 'results-shown'>('idle');
    const [generationCount, setGenerationCount] = useState<number>(4);

    // Cropping state
    const [cropQueue, setCropQueue] = useState<{ dataUrl: string; type: 'main' | 'inspiration' }[]>([]);
    const [crop, setCrop] = useState<Crop>();
    const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
    const imgRef = useRef<HTMLImageElement>(null);

    // Paste image state
    const [pastedImages, setPastedImages] = useState<string[]>([]);
    const [isPasteModalOpen, setIsPasteModalOpen] = useState<boolean>(false);

    useEffect(() => {
        const handlePaste = (event: ClipboardEvent) => {
            // Don't interfere with text input pasting
            if (document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.tagName === 'INPUT') {
                return;
            }

            const items = event.clipboardData?.items;
            if (!items) return;

            const imageFiles = Array.from(items)
                .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
                .map(item => item.getAsFile());

            // FIX: Filter out null values to ensure we only process valid files.
            const validImageFiles = imageFiles.filter((file): file is File => file !== null);

            if (validImageFiles.length > 0) {
                event.preventDefault();
                const filePromises = validImageFiles.map(file => {
                    return new Promise<string>((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                            if (reader.result) {
                                resolve(reader.result as string);
                            } else {
                                reject('Failed to read file');
                            }
                        };
                        reader.onerror = reject;
                        reader.readAsDataURL(file);
                    });
                });

                Promise.all(filePromises).then(dataUrls => {
                    setPastedImages(dataUrls);
                    setIsPasteModalOpen(true);
                }).catch(err => {
                    console.error("Error reading pasted images:", err);
                });
            }
        };

        window.addEventListener('paste', handlePaste);

        return () => {
            window.removeEventListener('paste', handlePaste);
        };
    }, []);

    const handleAddPastedImages = (type: 'main' | 'inspiration') => {
        const maxImages = type === 'main' ? MAX_MAIN_IMAGES : MAX_INSPIRATION_IMAGES;
        const currentCount = type === 'main' ? uploadedImages.length : inspirationImages.length;
        const availableSlots = maxImages - currentCount;
        
        if (availableSlots <= 0) return;

        const imagesToAdd = pastedImages.slice(0, availableSlots);
        const newQueueItems = imagesToAdd.map(dataUrl => ({ dataUrl, type }));

        setCropQueue(prev => [...prev, ...newQueueItems]);
        
        setIsPasteModalOpen(false);
        setPastedImages([]);
    };

    const handleCancelPaste = () => {
        setIsPasteModalOpen(false);
        setPastedImages([]);
    }

    const handleImageUpload = (e: ChangeEvent<HTMLInputElement>, type: 'main' | 'inspiration') => {
        if (e.target.files) {
            const maxImages = type === 'main' ? MAX_MAIN_IMAGES : MAX_INSPIRATION_IMAGES;
            const currentCount = type === 'main' ? uploadedImages.length : inspirationImages.length;
            
            const files = Array.from(e.target.files).slice(0, maxImages - currentCount);
            
            const newQueueItems: Promise<{ dataUrl: string, type: 'main' | 'inspiration' }>[] = files.map(file => {
                return new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        resolve({ dataUrl: reader.result as string, type });
                    };
                    reader.readAsDataURL(file);
                });
            });

            Promise.all(newQueueItems).then(items => {
                setCropQueue(prev => [...prev, ...items]);
            });
            
            e.target.value = '';
        }
    };

    const removeMainImage = (index: number) => {
        setUploadedImages(prev => prev.filter((_, i) => i !== index));
    };
    
    const removeInspirationImage = (index: number) => {
        setInspirationImages(prev => prev.filter((_, i) => i !== index));
    };

    const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
        const { width, height } = e.currentTarget;
        const initialCrop = centerCrop(
            makeAspectCrop({ unit: '%', width: 90 }, 1, width, height),
            width,
            height
        );
        setCrop(initialCrop);
    };

    const handleCropConfirm = async () => {
        const image = imgRef.current;
        if (!image || !completedCrop || cropQueue.length === 0) return;

        const canvas = document.createElement('canvas');
        canvasPreview(image, canvas, completedCrop);
        const croppedDataUrl = canvas.toDataURL('image/jpeg', 0.9);
        const currentItem = cropQueue[0];

        if (currentItem.type === 'main') {
            setUploadedImages(prev => [...prev, croppedDataUrl]);
        } else {
            setInspirationImages(prev => [...prev, croppedDataUrl]);
        }
        
        setAppState('photos-uploaded');
        setCropQueue(q => q.slice(1));
        setCrop(undefined);
        setCompletedCrop(undefined);
    };

    const handleCropCancel = () => {
        setCropQueue(q => q.slice(1));
        setCrop(undefined);
        setCompletedCrop(undefined);
    };

    const handleGenerateClick = async () => {
        if (uploadedImages.length === 0 || inspirationImages.length === 0) return;

        setAppState('generating');
        const initialImages: GeneratedImage[] = Array(generationCount).fill({ status: 'pending' });
        setGeneratedImages(initialImages);

        const generationPromises = Array(generationCount).fill(null).map((_, index) => 
            generateVibeBasedImage(uploadedImages, inspirationImages, userPrompt)
                .then(resultUrl => ({ status: 'done', url: resultUrl } as GeneratedImage))
                .catch(err => {
                    const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
                    console.error(`Failed to generate image slot ${index + 1}:`, err);
                    return { status: 'error', error: errorMessage } as GeneratedImage;
                })
        );
        
        for (let i = 0; i < generationPromises.length; i++) {
            generationPromises[i].then(result => {
                setGeneratedImages(prev => {
                    const newImages = [...prev];
                    newImages[i] = result;
                    return newImages;
                });
            });
        }
        
        await Promise.all(generationPromises);
        
        setAppState('results-shown');
    };

    const handleRegenerateSlot = async (index: number) => {
        if (uploadedImages.length === 0 || inspirationImages.length === 0) return;
        if (generatedImages[index]?.status === 'pending') return;
        
        setGeneratedImages(prev => {
            const newImages = [...prev];
            newImages[index] = { status: 'pending' };
            return newImages;
        });

        try {
            const resultUrl = await generateVibeBasedImage(uploadedImages, inspirationImages, userPrompt);
            setGeneratedImages(prev => {
                const newImages = [...prev];
                newImages[index] = { status: 'done', url: resultUrl };
                return newImages;
            });
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
            setGeneratedImages(prev => {
                const newImages = [...prev];
                newImages[index] = { status: 'error', error: errorMessage };
                return newImages;
            });
            console.error(`Failed to regenerate image for slot ${index}:`, err);
        }
    };
    
    const handleReset = () => {
        setUploadedImages([]);
        setInspirationImages([]);
        setGeneratedImages([]);
        setUserPrompt('');
        setAppState('idle');
    };

    const handleDownloadIndividualImage = (index: number) => {
        const image = generatedImages[index];
        if (image?.status === 'done' && image.url) {
            const link = document.createElement('a');
            link.href = image.url;
            link.download = `perfect-shot-${index + 1}.jpg`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };

    const handleDownloadAlbum = async () => {
        setIsDownloading(true);
        try {
            const imageData: Record<string, string> = {};
            generatedImages.forEach((image, index) => {
                if (image.status === 'done' && image.url) {
                    imageData[`Result ${index + 1}`] = image.url;
                }
            });

            if (Object.keys(imageData).length === 0) {
                alert("No images have been successfully generated to create an album.");
                return;
            }

            const albumDataUrl = await createAlbumPage(imageData);

            const link = document.createElement('a');
            link.href = albumDataUrl;
            link.download = 'perfect-shot-album.jpg';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

        } catch (error) {
            console.error("Failed to create or download album:", error);
            alert("Sorry, there was an error creating your album. Please try again.");
        } finally {
            setIsDownloading(false);
        }
    };

    const isGenerateButtonDisabled = uploadedImages.length === 0 || inspirationImages.length === 0 || appState === 'generating';

    return (
        <main className="bg-gradient-to-br from-pink-400 via-purple-500 to-orange-500 text-white min-h-screen w-full flex flex-col items-center justify-center p-4 pb-24 overflow-y-auto">
            <AnimatePresence>
                {isPasteModalOpen && pastedImages.length > 0 && (
                    <motion.div
                        className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    >
                        <motion.div
                            className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 w-full max-w-md flex flex-col items-center gap-4 text-white"
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                        >
                            <h2 className="text-2xl font-bold">Image Pasted</h2>
                            <p className="text-neutral-200 text-center">
                               {pastedImages.length} image{pastedImages.length > 1 ? 's' : ''} detected. Where should {pastedImages.length > 1 ? 'they' : 'it'} go?
                            </p>
                            <img 
                                src={pastedImages[0]} 
                                alt="Pasted preview" 
                                className="max-h-40 rounded-lg object-contain my-2 shadow-lg"
                            />
                            <div className="flex flex-col sm:flex-row gap-4 w-full mt-2">
                                <button 
                                    onClick={() => handleAddPastedImages('main')} 
                                    className={`${primaryButtonClasses} w-full`}
                                    disabled={uploadedImages.length >= MAX_MAIN_IMAGES}
                                >
                                    Add to Your Photos ({uploadedImages.length}/{MAX_MAIN_IMAGES})
                                </button>
                                <button 
                                    onClick={() => handleAddPastedImages('inspiration')} 
                                    className="text-lg font-semibold text-center text-white bg-purple-500 py-3 px-8 rounded-full transform transition-transform duration-200 hover:scale-105 hover:bg-purple-600 shadow-lg disabled:bg-neutral-400 disabled:cursor-not-allowed disabled:scale-100 w-full"
                                    disabled={inspirationImages.length >= MAX_INSPIRATION_IMAGES}
                                >
                                    Add to Vibe Photos ({inspirationImages.length}/{MAX_INSPIRATION_IMAGES})
                                </button>
                            </div>
                             <button onClick={handleCancelPaste} className="mt-2 text-neutral-300 hover:text-white transition-colors">Cancel</button>
                        </motion.div>
                    </motion.div>
                )}

                {cropQueue.length > 0 && (
                    <motion.div
                        className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    >
                        <motion.div
                            className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 w-full max-w-lg flex flex-col items-center gap-4"
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                        >
                            <h2 className="text-2xl font-bold text-white">Crop Your Image</h2>
                            <div className="max-h-[60vh] overflow-hidden">
                                <ReactCrop
                                    crop={crop}
                                    onChange={(_, percentCrop) => setCrop(percentCrop)}
                                    onComplete={(c) => setCompletedCrop(c)}
                                    aspect={1}
                                    className="max-h-full"
                                >
                                    <img 
                                      ref={imgRef} 
                                      src={cropQueue[0].dataUrl} 
                                      onLoad={onImageLoad} 
                                      alt="Image to crop"
                                      className="max-h-[60vh] object-contain"
                                    />
                                </ReactCrop>
                            </div>
                            <div className="flex gap-4 mt-2">
                                <button onClick={handleCropCancel} className={secondaryButtonClasses}>Skip</button>
                                <button onClick={handleCropConfirm} className={primaryButtonClasses}>Crop & Save</button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="z-10 flex flex-col items-center justify-center w-full h-full flex-1 min-h-0">
                <div className="text-center mb-10">
                    <h1 className="text-6xl md:text-8xl font-bold">Perfect Shot</h1>
                    <p className="text-neutral-200 mt-2 text-xl tracking-wide">Get your perfect shot, effortlessly.</p>
                </div>

                {(appState === 'idle' || appState === 'photos-uploaded') && (
                     <motion.div 
                        className="w-full max-w-4xl mx-auto flex flex-col gap-8 items-start"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                     >
                        <div className="w-full flex flex-col lg:flex-row gap-8 items-start">
                            <div className="flex-1 w-full flex flex-col items-center gap-4 p-6 bg-white/10 rounded-2xl">
                                <h2 className="text-2xl font-bold text-white">1. Upload Your Photos</h2>
                                <div className="w-full min-h-[200px] bg-black/20 rounded-lg p-3 grid grid-cols-3 gap-3">
                                    <AnimatePresence>
                                        {uploadedImages.map((src, index) => (
                                            <motion.div key={src.slice(0, 30) + index} className="relative aspect-square" layout
                                                initial={{ opacity: 0, scale: 0.5 }}
                                                animate={{ opacity: 1, scale: 1 }}
                                                exit={{ opacity: 0, scale: 0.5 }}
                                            >
                                                <img src={src} className="w-full h-full object-cover rounded-md" alt={`Your Photo ${index + 1}`}/>
                                                <button onClick={() => removeMainImage(index)} className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full h-5 w-5 flex items-center justify-center text-xs font-bold">&times;</button>
                                            </motion.div>
                                        ))}
                                    </AnimatePresence>
                                </div>
                                {uploadedImages.length < MAX_MAIN_IMAGES && (
                                    <label htmlFor="main-file-upload" className={fileInputButtonClasses}>
                                        Add Your Photos ({uploadedImages.length}/{MAX_MAIN_IMAGES})
                                    </label>
                                )}
                                <input id="main-file-upload" type="file" multiple className="hidden" accept="image/png, image/jpeg, image/webp" onChange={(e) => handleImageUpload(e, 'main')} disabled={uploadedImages.length >= MAX_MAIN_IMAGES}/>
                            </div>

                            <div className="flex-1 w-full flex flex-col items-center gap-4 p-6 bg-white/10 rounded-2xl">
                                <h2 className="text-2xl font-bold text-white">2. Upload Vibe Photos</h2>
                                <div className="w-full min-h-[200px] bg-black/20 rounded-lg p-3 grid grid-cols-3 gap-3">
                                    <AnimatePresence>
                                        {inspirationImages.map((src, index) => (
                                            <motion.div key={src.slice(0, 30) + index} className="relative aspect-square" layout
                                                initial={{ opacity: 0, scale: 0.5 }}
                                                animate={{ opacity: 1, scale: 1 }}
                                                exit={{ opacity: 0, scale: 0.5 }}
                                            >
                                                <img src={src} className="w-full h-full object-cover rounded-md" alt={`Inspiration ${index + 1}`}/>
                                                <button onClick={() => removeInspirationImage(index)} className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full h-5 w-5 flex items-center justify-center text-xs font-bold">&times;</button>
                                            </motion.div>
                                        ))}
                                    </AnimatePresence>
                                </div>
                                {inspirationImages.length < MAX_INSPIRATION_IMAGES && (
                                    <label htmlFor="inspiration-file-upload" className={fileInputButtonClasses}>
                                        Add Photos ({inspirationImages.length}/{MAX_INSPIRATION_IMAGES})
                                    </label>
                                )}
                                <input id="inspiration-file-upload" type="file" multiple className="hidden" accept="image/png, image/jpeg, image/webp" onChange={(e) => handleImageUpload(e, 'inspiration')} disabled={inspirationImages.length >= MAX_INSPIRATION_IMAGES}/>
                            </div>
                        </div>
                        
                        <div className="w-full flex flex-col items-center gap-4 p-6 bg-white/10 rounded-2xl">
                             <h2 className="text-2xl font-bold text-white">3. (Optional) Add Instructions</h2>
                             <textarea
                                 value={userPrompt}
                                 onChange={(e) => setUserPrompt(e.target.value)}
                                 placeholder="e.g., make my hair blue, place me in a futuristic city, turn this into a watercolor painting..."
                                 className="w-full h-24 bg-black/20 rounded-lg p-3 text-white placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-orange-400 transition-all"
                                 aria-label="Additional instructions for image generation"
                             />
                        </div>
                        
                        <div className="w-full flex flex-col items-center gap-4 p-6 bg-white/10 rounded-2xl">
                            <h2 className="text-2xl font-bold text-white">4. Number of Images</h2>
                            <div className="w-full flex items-center gap-4 px-2">
                                <input
                                    type="range"
                                    min="1"
                                    max="8"
                                    value={generationCount}
                                    onChange={(e) => setGenerationCount(Number(e.target.value))}
                                    className="w-full h-2 bg-black/30 rounded-lg appearance-none cursor-pointer accent-orange-500"
                                    aria-label="Number of images to generate"
                                />
                                <span className="text-2xl font-bold w-12 text-center select-none">{generationCount}</span>
                            </div>
                        </div>
                    </motion.div>
                )}

                {(appState === 'idle' || appState === 'photos-uploaded') && (
                     <div className="mt-8">
                         <button onClick={handleGenerateClick} className={primaryButtonClasses} disabled={isGenerateButtonDisabled}>
                            Generate ({generationCount} Image{generationCount > 1 ? 's' : ''})
                        </button>
                    </div>
                )}


                {(appState === 'generating' || appState === 'results-shown') && (
                     <>
                        <div className="w-full max-w-7xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 mt-4 px-4">
                            {generatedImages.map((image, index) => (
                                <motion.div 
                                    key={index}
                                    className="flex justify-center"
                                    initial={{ opacity: 0, y: 50 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.5, delay: index * 0.1 }}
                                >
                                     <PhotoCard
                                        caption={`Result ${index + 1}`}
                                        status={image.status}
                                        imageUrl={image.url}
                                        error={image.error}
                                        onRegenerate={() => handleRegenerateSlot(index)}
                                        onDownload={() => handleDownloadIndividualImage(index)}
                                    />
                                </motion.div>
                            ))}
                        </div>
                         <div className="h-20 mt-8 flex items-center justify-center">
                            {appState === 'results-shown' && (
                                <motion.div 
                                    className="flex flex-col sm:flex-row items-center gap-4"
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.5 }}
                                >
                                    <button 
                                        onClick={handleDownloadAlbum} 
                                        disabled={isDownloading} 
                                        className={`${primaryButtonClasses} disabled:opacity-50 disabled:cursor-not-allowed`}
                                    >
                                        {isDownloading ? 'Creating Album...' : 'Download Album'}
                                    </button>
                                    <button onClick={handleReset} className={secondaryButtonClasses}>
                                        Start Over
                                    </button>
                                </motion.div>
                            )}
                             {appState === 'generating' && (
                                 <div className="text-center">
                                     <p className="text-xl font-semibold animate-pulse">Analyzing the vibe and generating your shots...</p>
                                     <p className="text-neutral-300 mt-1">This may take a moment.</p>
                                 </div>
                             )}
                        </div>
                    </>
                )}
            </div>
            <Footer />
        </main>
    );
}

export default App;