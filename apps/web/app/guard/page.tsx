import { GuardForm } from "@/components/guard/guard-form";

export default function GuardPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[10px] tracking-[0.3em] text-[#2196f3]">GUARD</p>
        <h1 className="font-display text-4xl uppercase">Check before you sign</h1>
        <p className="mt-2 max-w-3xl text-sm text-[#b5b0a8]">
          The pipeline declares each check as a Telegraph intent, lets the network pick the miner, pays per answer, and shows every signal, including the ones that were unavailable or skipped. Nothing here is cached or simulated.
        </p>
      </div>
      <GuardForm />
    </div>
  );
}
