import React from 'react';
import { Button } from '@/components/ui/button';

export default function ConfirmDeleteDialog({ itemName, onConfirm }) {
  const [isOpen, setIsOpen] = React.useState(false);

  return (
    <>
      <Button variant="destructive" onClick={() => setIsOpen(true)}>
        Delete
      </Button>
      {isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background p-6 rounded-lg border shadow-lg max-w-sm w-full">
            <h3 className="text-lg font-bold mb-2">Confirm Delete</h3>
            <p className="text-muted-foreground mb-4">Are you sure you want to delete {itemName}? This action cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setIsOpen(false)}>Cancel</Button>
              <Button variant="destructive" onClick={() => { onConfirm(); setIsOpen(false); }}>
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}