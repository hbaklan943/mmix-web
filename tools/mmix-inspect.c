/* mmix-inspect.c — tiny exported helpers for the browser UI.
   Links against mmix-sim.c (g[], inst_ptr, mem_find) which are
   non-static symbols in the generated C. */
typedef unsigned int tetra;
typedef struct { tetra h, l; } octa;

extern octa g[256];
extern octa inst_ptr;
extern void *mem_find(octa);

octa *mmix_get_g_ptr(void) { return g; }
int   mmix_get_inst_ptr_addr(void) { return (int)&inst_ptr; }
tetra mmix_mem_read_tetra(tetra h, tetra l) {
  octa a; a.h = h; a.l = l;
  void *p = mem_find(a);
  if (!p) return 0;
  return *(tetra *)p;
}
