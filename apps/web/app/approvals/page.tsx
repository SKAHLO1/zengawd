import { ApprovalsView } from "@/components/approvals/approvals-view";

export default function ApprovalsPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[10px] tracking-[0.3em] text-[#2196f3]">APPROVALS</p>
        <h1 className="font-display text-4xl uppercase">What you already signed</h1>
        <p className="mt-2 max-w-3xl text-sm text-[#b5b0a8]">
          Outstanding ERC-20 and ERC-721 approvals are found by scanning Approval and ApprovalForAll logs and checking the live allowance. The watcher re-runs Stage 1 against every pair on a fixed interval; a pair that was ALLOW and becomes BLOCK gets a recommendation here. Auto-revocation is off unless you explicitly opt in with a Safe that delegates to the guard module.
        </p>
      </div>
      <ApprovalsView />
    </div>
  );
}
