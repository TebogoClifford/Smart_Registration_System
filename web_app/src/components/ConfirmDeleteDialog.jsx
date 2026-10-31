import React from 'react';
import { Button } from '@/components/ui/button';

export default function ConfirmDeleteDialog({ itemName, onConfirm, label = 'Delete', title = 'Confirm Delete' }) {
  const [isOpen, setIsOpen] = React.useState(false);

  return (
    <>
      <Button type="button" variant="destructive" onClick={() => setIsOpen(true)}>
        {label}
      </Button>
      {isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background p-6 rounded-lg border shadow-lg max-w-sm w-full">
            <h3 className="text-lg font-bold mb-2">{title}</h3>
            <p className="text-muted-foreground mb-4">Are you sure you want to {label.toLowerCase()} {itemName}? This action cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>Cancel</Button>
              <Button type="button" variant="destructive" onClick={() => { onConfirm(); setIsOpen(false); }}>
                {label}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}