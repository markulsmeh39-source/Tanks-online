import React from 'react';
import { motion } from 'motion/react';
import { Shield, Zap, Target, Rocket } from 'lucide-react';
import { PlayerState } from '../types';

interface TankPickerProps {
  onSelect: (tankType: PlayerState['tankType'], color: string, name: string) => void;
}

const TANK_OPTIONS = [
  {
    type: 'scout' as const,
    name: 'STINGER',
    icon: Zap,
    description: 'High mobility, fast reloading. Perfect for flanking.',
    stats: { speed: 100, health: 40, damage: 30 },
    color: '#3b82f6', // Bright Blue
  },
  {
    type: 'balanced' as const,
    name: 'STRIKER',
    icon: Target,
    description: 'The standard issue vanguard. Reliable in all situations.',
    stats: { speed: 60, health: 70, damage: 60 },
    color: '#10b981', // Emerald
  },
  {
    type: 'heavy' as const,
    name: 'GOLIATH',
    icon: Shield,
    description: 'Slow but indestructible.\nDevastating firepower.',
    stats: { speed: 30, health: 100, damage: 100 },
    color: '#ef4444', // Red
  },
];

export const TankPicker: React.FC<TankPickerProps> = ({ onSelect }) => {
  return (
    <div className="flex flex-col items-center justify-center p-4 md:p-8 min-h-full">
      <motion.h2 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-2xl md:text-5xl font-black mb-4 md:mb-12 tracking-tighter text-slate-100 italic"
      >
        SELECT CHASSIS
      </motion.h2>

      <div className="grid grid-cols-1 landscape:grid-cols-3 sm:grid-cols-3 gap-2 md:gap-8 w-full max-w-6xl px-2 md:px-4">
        {TANK_OPTIONS.map((option, idx) => (
          <motion.button
            key={option.type}
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            whileHover={{ y: -10 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onSelect(option.type, option.color, option.name)}
            className="metal-panel p-3 md:p-8 rounded-xl md:rounded-3xl flex flex-col items-center text-center relative group overflow-hidden border border-slate-800 bg-slate-900/40 w-full"
          >
            <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none opacity-20" />
            
            <div 
              className="p-3 md:p-6 rounded-xl md:rounded-2xl mb-2 md:mb-8 shadow-2xl backdrop-blur-md" 
              style={{ backgroundColor: option.color + '15', color: option.color, border: `1px solid ${option.color}40` }}
            >
              <option.icon className="w-6 h-6 md:w-14 md:h-14" />
            </div>

            <h3 className="text-lg md:text-3xl font-black mb-1 md:mb-3 tracking-[2px] md:tracking-[3px]" style={{ color: option.color }}>
              {option.name}
            </h3>
            
            <p className="hidden md:block text-slate-400 text-xs md:text-sm mb-4 md:mb-8 leading-relaxed font-medium whitespace-pre-line flex-1">
              {option.description}
            </p>

            <div className="w-full space-y-1.5 md:space-y-4">
              {Object.entries(option.stats).map(([stat, value]) => (
                <div key={stat} className="w-full">
                  <div className="flex justify-between text-[8px] md:text-[9px] uppercase font-black mb-1 md:mb-1.5 tracking-widest text-slate-500">
                    <span>{stat}</span>
                    <span className="text-slate-300">{value}%</span>
                  </div>
                  <div className="h-1 md:h-1.5 bg-slate-800 rounded-full overflow-hidden border border-white/5">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${value}%` }}
                      className="h-full shadow-[0_0_10px_rgba(255,255,255,0.1)]" 
                      style={{ backgroundColor: option.color }} 
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 md:mt-10 px-4 md:px-8 py-2 md:py-3 bg-slate-800/50 border border-slate-700 rounded-lg md:rounded-xl text-[8px] md:text-[10px] font-black tracking-[2px] md:tracking-[4px] uppercase group-hover:bg-emerald-600 group-hover:border-emerald-400 group-hover:text-white transition-all shadow-lg w-full">
              DEPLOY UNIT
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  );
};
