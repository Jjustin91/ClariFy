'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const dummyAccounts = [
  { email: 'student@ustp.edu.ph', password: 'Password123!', role: 'student', name: 'Student User' },
  { email: 'faculty@ustp.edu.ph', password: 'Password123!', role: 'faculty', name: 'Dr. Faculty Name' },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate directly against dummy accounts array
    const account = dummyAccounts.find(
      (acc) => acc.email.toLowerCase() === email.toLowerCase() && acc.password === password
    );

    if (account) {
      // Set auth cookie so Next.js middleware grants access
      document.cookie = `auth_token=mock_token_123; path=/; max-age=86400`;
      localStorage.setItem('user_role', account.role);
      localStorage.setItem('user_name', account.name);

      router.push('/dashboard');
    } else {
      setError('Invalid email or password. Use student@ustp.edu.ph / Password123!');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#1a1851] p-4 font-sans">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 space-y-6">
        
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="h-12 w-12 bg-[#fcb315] rounded-xl flex items-center justify-center font-bold text-slate-900 mx-auto text-lg shadow-sm">
            CF
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Sign in to ClariFy</h1>
          <p className="text-xs text-slate-500">Enter your university credentials to continue</p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 text-xs p-3 rounded-lg text-center font-medium">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="student@ustp.edu.ph"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1a1851]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1a1851]"
            />
          </div>

          <button
            type="submit"
            className="w-full bg-[#1a1851] hover:bg-indigo-950 text-white font-bold py-2.5 rounded-lg text-xs transition-colors cursor-pointer"
          >
            Sign In
          </button>
        </form>

        {/* Helper Hint */}
        <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-400 text-center space-y-1">
          <p className="font-semibold text-slate-500">Demo Credentials:</p>
          <p><span className="font-semibold text-slate-600">Student:</span> student@ustp.edu.ph</p>
          <p><span className="font-semibold text-slate-600">Faculty:</span> faculty@ustp.edu.ph</p>
          <p><span className="font-semibold text-slate-600">Password:</span> Password123!</p>
        </div>

      </div>
    </div>
  );
}
