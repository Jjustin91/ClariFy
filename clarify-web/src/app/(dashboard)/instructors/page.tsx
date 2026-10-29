import { InstructorDirectoryGrid } from '@/components/instructors/InstructorDirectoryGrid';
import { RightProfileSidebar } from '@/components/layout/RightProfileSidebar';

export default function InstructorsDirectoryPage() {
  return (
    <div className="flex min-h-screen bg-slate-900 font-sans text-slate-900">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-indigo-950 bg-[#1a1851] px-8 text-white">
          <h1 className="text-2xl font-bold tracking-tight">View Faculty</h1>
          <div className="flex h-8 w-8 items-center justify-center rounded bg-white/20 text-[10px] font-bold">
            logo
          </div>
        </header>

        <main className="flex-1 space-y-6 overflow-y-auto bg-[#FFFAF2] p-8">
          <div className="mx-auto w-full max-w-6xl space-y-6">
            <div>
              <p className="text-sm font-bold uppercase tracking-wide text-ustp-blue">CDO Campus</p>
              <p className="mt-2 text-sm text-ustp-text/70">Find verified faculty by name or department.</p>
            </div>
            <InstructorDirectoryGrid />
          </div>
        </main>
      </div>

      <RightProfileSidebar />
    </div>
  );
}
