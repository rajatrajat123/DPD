'use client';

import React, { createContext, useContext, useState, ReactNode } from 'react';

interface StepUpContextType {
  stepUpToken: string | null;
  setStepUpToken: (token: string | null) => void;
  isModalOpen: boolean;
  openStepUpModal: (callback?: (token: string) => void) => void;
  closeStepUpModal: () => void;
}

const StepUpContext = createContext<StepUpContextType>({
  stepUpToken: null,
  setStepUpToken: () => {},
  isModalOpen: false,
  openStepUpModal: () => {},
  closeStepUpModal: () => {},
});

export function StepUpProvider({ children }: { children: ReactNode }) {
  const [stepUpToken, setStepUpToken] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [pendingCallback, setPendingCallback] = useState<((token: string) => void) | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const openStepUpModal = (callback?: (token: string) => void) => {
    setError(null);
    setPassword('');
    if (callback) {
      setPendingCallback(() => callback);
    }
    setIsModalOpen(true);
  };

  const closeStepUpModal = () => {
    setIsModalOpen(false);
    setPassword('');
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setError('Password is required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/admin/auth/step-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.message || 'Authentication challenge failed');
      }

      const token = data.step_up_token;
      setStepUpToken(token);
      setIsModalOpen(false);
      setPassword('');

      if (pendingCallback) {
        pendingCallback(token);
        setPendingCallback(null);
      }
    } catch (err: any) {
      setError(err.message || 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <StepUpContext.Provider
      value={{
        stepUpToken,
        setStepUpToken,
        isModalOpen,
        openStepUpModal,
        closeStepUpModal,
      }}
    >
      {children}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-[#151821] border border-[#C3A15B]/40 rounded-2xl max-w-md w-full p-6 shadow-2xl relative">
            <button
              onClick={closeStepUpModal}
              className="absolute top-4 right-4 text-neutral-400 hover:text-white text-lg"
            >
              ✕
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-[#C3A15B]/20 border border-[#C3A15B]/40 flex items-center justify-center text-[#C3A15B]">
                🔒
              </div>
              <div>
                <h3 className="text-lg font-serif text-white font-medium">Step-Up Authentication</h3>
                <p className="text-xs text-neutral-400">High-security administrative operation</p>
              </div>
            </div>

            <p className="text-xs text-neutral-300 leading-relaxed mb-5">
              This action requires step-up re-authentication. Please confirm your administrative password to issue a short-lived cryptographically signed token.
            </p>

            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs uppercase tracking-wider text-neutral-400 font-medium mb-1">
                  Administrator Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter current password"
                  autoFocus
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B0D12] border border-neutral-700 text-white text-sm focus:outline-none focus:border-[#C3A15B]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeStepUpModal}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-neutral-300 hover:bg-neutral-800 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2 rounded-lg text-xs font-semibold bg-gradient-to-r from-[#C3A15B] to-[#E3C77D] text-[#0d0f12] hover:brightness-105 transition disabled:opacity-50"
                >
                  {loading ? 'Verifying...' : 'Verify & Continue'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </StepUpContext.Provider>
  );
}

export function useStepUp() {
  return useContext(StepUpContext);
}
