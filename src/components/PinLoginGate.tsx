import React, { useRef, useState } from 'react';
import { Lock, ShieldCheck } from 'lucide-react';
import miximageLogo from '../assets/images/miximage_logo.png';
import { verifyPin } from '../engine/pinAuth';

interface PinLoginGateProps {
  onAuthenticated: () => void;
}

export const PinLoginGate: React.FC<PinLoginGateProps> = ({ onAuthenticated }) => {
  const [pin, setPin] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handlePinChange = (rawValue: string) => {
    const digitsOnly = rawValue.replace(/\D/g, '').slice(0, 6);
    setPin(digitsOnly);
    if (errorMsg) setErrorMsg(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length < 6) {
      setErrorMsg('กรุณากรอกรหัส PIN ให้ครบ 6 หลัก');
      inputRef.current?.focus();
      return;
    }

    if (verifyPin(pin)) {
      setErrorMsg(null);
      onAuthenticated();
    } else {
      setErrorMsg('รหัส PIN ไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง');
      setPin('');
      inputRef.current?.focus();
    }
  };

  return (
    <div className="min-h-screen bg-[#090D16] text-slate-100 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Subtle studio ambient glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(14,165,233,0.12),transparent_55%)]"
      />

      <main className="relative z-10 w-full max-w-md bg-[#111827] border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl flex flex-col items-center gap-6">
        <div className="flex flex-col items-center text-center gap-3">
          <div className="w-20 h-20 rounded-2xl bg-[#070B14] border border-slate-800 p-2 flex items-center justify-center shadow-lg">
            <img
              src={miximageLogo}
              alt="MixImage Studio"
              className="w-full h-full object-contain"
            />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-50">
              เข้าสู่ระบบ MixImage Studio
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              กรุณากรอกรหัส PIN 6 หลักด้วยตนเองเพื่อเข้าใช้งานสตูดิโอ
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-2">
            <label
              htmlFor="pin-login-input"
              className="text-xs font-medium text-slate-300 flex items-center gap-1.5"
            >
              <Lock className="w-3.5 h-3.5 text-sky-400" aria-hidden="true" />
              <span>รหัส PIN 6 หลัก</span>
            </label>

            {/* 6 visual masked dot indicators */}
            <div
              aria-hidden="true"
              onClick={() => inputRef.current?.focus()}
              className="grid grid-cols-6 gap-2 cursor-text"
            >
              {[0, 1, 2, 3, 4, 5].map((idx) => {
                const filled = idx < pin.length;
                const activeSlot = idx === Math.min(pin.length, 5);
                return (
                  <div
                    key={idx}
                    className={`h-11 rounded-lg border flex items-center justify-center transition-colors ${
                      filled
                        ? 'border-sky-400 bg-sky-500/15'
                        : activeSlot
                          ? 'border-slate-600 bg-[#090D16]'
                          : 'border-slate-800 bg-[#090D16]'
                    }`}
                  >
                    <span
                      className={`w-2.5 h-2.5 rounded-full transition-all ${
                        filled ? 'bg-sky-300 scale-100' : 'bg-slate-700 scale-75'
                      }`}
                    />
                  </div>
                );
              })}
            </div>

            <input
              ref={inputRef}
              id="pin-login-input"
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoComplete="off"
              autoFocus
              aria-label="กรอกรหัส PIN 6 หลัก"
              placeholder="กรอกรหัส PIN 6 หลัก"
              value={pin}
              onChange={(e) => handlePinChange(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg bg-[#090D16] border border-slate-700 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/30 text-center font-mono text-base tracking-[0.4em] text-slate-100 placeholder:tracking-normal placeholder:text-xs placeholder:text-slate-500"
            />
          </div>

          {errorMsg && (
            <p
              role="alert"
              className="text-xs text-rose-400 bg-rose-950/30 border border-rose-900/60 rounded-lg px-3 py-2 text-center"
            >
              {errorMsg}
            </p>
          )}

          <button
            type="submit"
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
          >
            <ShieldCheck className="w-4 h-4" aria-hidden="true" />
            <span>เข้าสู่ระบบ</span>
          </button>
        </form>
      </main>
    </div>
  );
};
