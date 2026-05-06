import { useState, useEffect, useRef } from "react";
import { X, ArrowRight, ArrowLeft, Check } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface TourStep {
  target: string;
  title: string;
  content: string;
  position?: "top" | "bottom" | "left" | "right";
}

interface OnboardingTourProps {
  steps: TourStep[];
  onComplete: () => void;
  onSkip?: () => void;
  showTour: boolean;
}

export function OnboardingTour({ steps, onComplete, onSkip, showTour }: OnboardingTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const highlightedElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!showTour) return;

    const step = steps[currentStep];
    const element = document.querySelector(step.target) as HTMLElement;
    
    if (element) {
      highlightedElementRef.current = element;
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    return () => {
      if (highlightedElementRef.current) {
        highlightedElementRef.current.style.boxShadow = "";
        highlightedElementRef.current.style.zIndex = "";
        highlightedElementRef.current = null;
      }
    };
  }, [currentStep, steps, showTour]);

  useEffect(() => {
    if (highlightedElementRef.current) {
      highlightedElementRef.current.style.boxShadow = "0 0 0 4px rgba(0, 217, 165, 0.5), 0 0 0 8px rgba(0, 217, 165, 0.2)";
      highlightedElementRef.current.style.zIndex = "50";
      highlightedElementRef.current.style.position = "relative";
    }
  }, [currentStep]);

  const next = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      onComplete();
    }
  };

  const prev = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  if (!showTour) return null;

  const step = steps[currentStep];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="max-w-md w-full mx-4 rounded-2xl border border-edge/50 bg-panel/95 backdrop-blur-xl shadow-2xl p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center">
              <Check className="w-4 h-4 text-accent" />
            </div>
            <div>
              <h3 className="text-app-text font-semibold">{step.title}</h3>
              <p className="text-xs text-app-muted">
                Step {currentStep + 1} of {steps.length}
              </p>
            </div>
          </div>
          <Button
            onClick={onSkip || onComplete}
            variant="ghost"
            size="sm"
            className="p-1.5 rounded-lg text-app-muted hover:text-app-text"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <p className="text-app-muted text-sm leading-relaxed">{step.content}</p>

        <div className="flex items-center justify-between pt-2">
          <Button
            onClick={prev}
            disabled={currentStep === 0}
            variant="ghost"
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-app-muted hover:text-app-text border border-edge"
          >
            <ArrowLeft className="w-4 h-4" />
            Previous
          </Button>

          <div className="flex gap-1">
            {steps.map((_, idx) => (
              <div
                key={idx}
                className={`w-2 h-2 rounded-full transition-all ${
                  idx === currentStep ? "bg-accent w-6" : "bg-edge/50"
                }`}
              />
            ))}
          </div>

          <Button
            onClick={next}
            variant="primary"
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
          >
            {currentStep === steps.length - 1 ? "Finish" : "Next"}
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function useOnboardingTour() {
  const [showTour, setShowTour] = useState(false);

  useEffect(() => {
    const hasSeenTour = localStorage.getItem("hasSeenOnboardingTour");
    if (!hasSeenTour) {
      setShowTour(true);
    }
  }, []);

  const completeTour = () => {
    setShowTour(false);
    localStorage.setItem("hasSeenOnboardingTour", "true");
  };

  const resetTour = () => {
    localStorage.removeItem("hasSeenOnboardingTour");
    setShowTour(true);
  };

  return { showTour, completeTour, resetTour };
}
