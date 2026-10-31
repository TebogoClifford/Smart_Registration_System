import { History } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Shown on an edit page whose fields came back from an earlier visit (see lib/drafts.js).
export default function DraftNotice({ show, onDiscard }) {
  if (!show) return null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <span className="inline-flex items-center gap-2"><History size={15} /> Unsaved changes from before are back. Save them, or discard to see what is stored.</span>
      <Button type="button" variant="outline" size="sm" onClick={onDiscard}>Discard changes</Button>
    </div>
  );
}
