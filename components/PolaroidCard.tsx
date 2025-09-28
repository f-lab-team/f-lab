/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React from 'react';
import { motion } from 'framer-motion';

interface PolaroidCardProps {
    imgSrc: string;
    alt: string;
    caption: string;
    className?: string;
    rotation: number;
    delay: number;
}

const PolaroidCard: React.FC<PolaroidCardProps> = ({ imgSrc, alt, caption, className, rotation, delay }) => {
    return (
        <motion.div
            className={`absolute bg-white p-2 pb-4 rounded-md shadow-2xl w-48 ${className}`}
            initial={{ opacity: 0, y: 50, rotate: rotation > 0 ? rotation + 10 : rotation - 10 }}
            animate={{ opacity: 1, y: 0, rotate: rotation }}
            transition={{ type: 'spring', stiffness: 100, damping: 20, delay }}
            whileHover={{ scale: 1.05, rotate: rotation - 2, zIndex: 30 }}
        >
            <div className="bg-neutral-200 w-full h-40 mb-2">
                <img src={imgSrc} alt={alt} className="w-full h-full object-cover" />
            </div>
            <p className="text-center text-sm font-medium text-neutral-800">{caption}</p>
        </motion.div>
    );
};

export default PolaroidCard;
