import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { Plus } from 'lucide-react';

export default function VenueList() {
  const [venues, setVenues] = useState([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const loadVenues = async () => {
    try {
      const data = await api.getVenues();
      setVenues(data);
    } catch (err) {
      toast.error('Failed to load venues');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => { loadVenues(); }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await api.createVenue(name);
      toast.success('Venue created');
      setName('');
      loadVenues();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Venues</h2>
          <p className="text-muted-foreground">Manage exam venue locations.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add New Venue</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="flex gap-2">
            <Input
              placeholder="Venue Name (e.g. Hall A)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button type="submit">
              <Plus size={16} className="mr-2" /> Add Venue
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="py-10 text-center text-muted-foreground">Loading...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Created At</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {venues.map((v) => (
                  <TableRow key={v.id} className="group">
                    <TableCell className="font-mono text-xs">{v.id}</TableCell>
                    <TableCell className="font-medium">{v.name}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {new Date(v.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate(`/venues/${v.id}`)}
                      >
                        Manage
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
