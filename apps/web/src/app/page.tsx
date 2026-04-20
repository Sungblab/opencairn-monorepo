// NOTE: skeleton landing. Approved warm editorial landing at landing/landing.html
// will be ported into Next.js in Plan 9 (billing-marketing). Do not style this
// skeleton as the final brand canon.
export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center">
      <h1 className="text-5xl font-bold tracking-tight">OpenCairn</h1>
      <p className="mt-4 text-lg text-neutral-400">
        AI knowledge base for learning, research, and work.
      </p>
      <a
        href="/dashboard"
        className="mt-8 rounded-lg bg-amber-500 px-6 py-3 text-sm font-semibold text-neutral-950 hover:bg-amber-400"
      >
        Get Started
      </a>
    </main>
  );
}
