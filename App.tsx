/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState, ChangeEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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

    const handleMainImagesUpload = (e: ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            const files = Array.from(e.target.files).slice(0, MAX_MAIN_IMAGES - uploadedImages.length);
            
            files.forEach(file => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    setUploadedImages(prev => [...prev, reader.result as string]);
                    setAppState('photos-uploaded');
                };
                reader.readAsDataURL(file);
            });
        }
    };

    const removeMainImage = (index: number) => {
        setUploadedImages(prev => prev.filter((_, i) => i !== index));
    };

    const handleInspirationImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            const files = Array.from(e.target.files).slice(0, MAX_INSPIRATION_IMAGES - inspirationImages.length);
            
            files.forEach(file => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    setInspirationImages(prev => [...prev, reader.result as string]);
                    setAppState('photos-uploaded');
                };
                reader.readAsDataURL(file);
            });
        }
    };
    
    const removeInspirationImage = (index: number) => {
        setInspirationImages(prev => prev.filter((_, i) => i !== index));
    };

    const handleGenerateClick = async () => {
        if (uploadedImages.length === 0 || inspirationImages.length === 0) return;

        setAppState('generating');
        const initialImages: GeneratedImage[] = Array(4).fill({ status: 'pending' });
        setGeneratedImages(initialImages);

        const generationPromises = Array(4).fill(null).map((_, index) => 
            generateVibeBasedImage(uploadedImages, inspirationImages, userPrompt)
                .then(resultUrl => ({ status: 'done', url: resultUrl } as GeneratedImage))
                .catch(err => {
                    const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
                    console.error(`Failed to generate image slot ${index + 1}:`, err);
                    return { status: 'error', error: errorMessage } as GeneratedImage;
                })
        );
        
        // This updates the UI as each image finishes, which is a better UX
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
                            {/* Left Side - Your Photos */}
                            <div className="flex-1 w-full flex flex-col items-center gap-4 p-6 bg-white/10 rounded-2xl">
                                <h2 className="text-2xl font-bold text-white">1. Upload Your Photos</h2>
                                <div className="w-full min-h-[200px] bg-black/20 rounded-lg p-3 grid grid-cols-3 gap-3">
                                    <AnimatePresence>
                                        {uploadedImages.map((src, index) => (
                                            <motion.div key={src.slice(0, 20) + index} className="relative aspect-square" layout
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
                                <input id="main-file-upload" type="file" multiple className="hidden" accept="image/png, image/jpeg, image/webp" onChange={handleMainImagesUpload} disabled={uploadedImages.length >= MAX_MAIN_IMAGES}/>
                            </div>

                            {/* Right Side - Inspiration Photos */}
                            <div className="flex-1 w-full flex flex-col items-center gap-4 p-6 bg-white/10 rounded-2xl">
                                <h2 className="text-2xl font-bold text-white">2. Upload Vibe Photos</h2>
                                <div className="w-full min-h-[200px] bg-black/20 rounded-lg p-3 grid grid-cols-3 gap-3">
                                    <AnimatePresence>
                                        {inspirationImages.map((src, index) => (
                                            <motion.div key={src.slice(0, 20) + index} className="relative aspect-square" layout
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
                                <input id="inspiration-file-upload" type="file" multiple className="hidden" accept="image/png, image/jpeg, image/webp" onChange={handleInspirationImageUpload} disabled={inspirationImages.length >= MAX_INSPIRATION_IMAGES}/>
                            </div>
                        </div>
                        
                        {/* Instructions Section */}
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
                    </motion.div>
                )}

                {(appState === 'idle' || appState === 'photos-uploaded') && (
                     <div className="mt-8">
                         <button onClick={handleGenerateClick} className={primaryButtonClasses} disabled={isGenerateButtonDisabled}>
                            Generate (4 Images)
                        </button>
                    </div>
                )}


                {(appState === 'generating' || appState === 'results-shown') && (
                     <>
                        <div className="w-full max-w-5xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-8 mt-4 px-4">
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