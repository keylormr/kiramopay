import React, { useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';

interface OnboardingStep {
  icon: React.FC<{ size?: number; className?: string }>;
  color: string;
  bgGradient: string;
}

const STEPS: OnboardingStep[] = [
  {
    icon: Icons.Wallet,
    color: 'text-blue-500',
    bgGradient: 'from-blue-500/20 to-indigo-500/10',
  },
  {
    icon: Icons.ArrowDownUp,
    color: 'text-green-500',
    bgGradient: 'from-green-500/20 to-emerald-500/10',
  },
  {
    icon: Icons.Shield,
    color: 'text-purple-500',
    bgGradient: 'from-purple-500/20 to-pink-500/10',
  },
  {
    icon: Icons.TrendingUp,
    color: 'text-orange-500',
    bgGradient: 'from-orange-500/20 to-amber-500/10',
  },
];

interface OnboardingViewProps {
  onComplete: () => void;
}

export const OnboardingView: React.FC<OnboardingViewProps> = ({ onComplete }) => {
  const { t } = useLanguage();
  const [currentStep, setCurrentStep] = useState(0);

  const titles = [
    t('onboard_title_1'),
    t('onboard_title_2'),
    t('onboard_title_3'),
    t('onboard_title_4'),
  ];

  const descriptions = [
    t('onboard_desc_1'),
    t('onboard_desc_2'),
    t('onboard_desc_3'),
    t('onboard_desc_4'),
  ];

  const step = STEPS[currentStep];
  const StepIcon = step.icon;
  const isLast = currentStep === STEPS.length - 1;

  const handleNext = () => {
    if (isLast) {
      localStorage.setItem('kiramopay_onboarded', 'true');
      onComplete();
    } else {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handleSkip = () => {
    localStorage.setItem('kiramopay_onboarded', 'true');
    onComplete();
  };

  return (
    <div className="fixed inset-0 z-[200] bg-white dark:bg-background-dark flex flex-col">
      {/* Skip button */}
      <div className="px-4 pt-4 flex justify-end">
        <button
          onClick={handleSkip}
          className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          {t('onboard_skip')}
        </button>
      </div>

      {/* Content area */}
      <div className="flex-1 flex flex-col items-center justify-center px-8" key={currentStep}>
        {/* Icon */}
        <div className={`w-32 h-32 rounded-[2rem] bg-gradient-to-br ${step.bgGradient} flex items-center justify-center mb-10 animate-fade-in-scale`}>
          <StepIcon size={56} className={step.color} />
        </div>

        {/* Title */}
        <h1 className="text-2xl font-black uv-text-primary text-center mb-4 animate-onboard-slide">
          {titles[currentStep]}
        </h1>

        {/* Description */}
        <p className="text-base uv-text-muted text-center leading-relaxed max-w-sm animate-onboard-slide" style={{ animationDelay: '100ms' }}>
          {descriptions[currentStep]}
        </p>
      </div>

      {/* Bottom section */}
      <div className="px-8 pb-12">
        {/* Dots */}
        <div className="flex justify-center gap-2 mb-8">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-2 rounded-full transition-all duration-300 ${
                i === currentStep
                  ? 'w-8 bg-primary'
                  : i < currentStep
                    ? 'w-2 bg-primary/40'
                    : 'w-2 bg-gray-200 dark:bg-gray-700'
              }`}
            />
          ))}
        </div>

        {/* Action button */}
        <button
          onClick={handleNext}
          className="w-full uv-gradient-brand text-white py-4 rounded-2xl font-bold text-lg active:scale-[0.98] transition-all shadow-lg shadow-primary/20"
        >
          {isLast ? t('onboard_get_started') : t('continue')}
        </button>
      </div>
    </div>
  );
};
