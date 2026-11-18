import { describe, expect, it } from 'vitest';
import { call, tool } from './helpers';

describe('categories in use', () => {
  it('refuses to delete a category that projects use, and says how many', async () => {
    const cat = await call('POST', '/categories', { label: 'Coding' });
    await call('POST', '/projects', { name: 'A', category_id: cat.id });
    await call('POST', '/projects', { name: 'B', category_id: cat.id });
    await call('POST', '/habits', { name: 'Practise', category_id: cat.id });
    const res = await call('DELETE', `/categories/${cat.id}`, undefined, { expect: 400 });
    expect(res.error).toContain('2 projects');
    expect(res.error).toContain('1 habit');
    const free = await call('POST', '/categories', { label: 'Empty' });
    await call('DELETE', `/categories/${free.id}`);
  });
});
