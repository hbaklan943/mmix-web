/* mmix-inspect.c — tiny exported helpers for the browser UI.
   Links against mmix-sim.c (g[], l[], inst_ptr, mem_find) which are
   non-static symbols in the generated C.

   Register file layout in MMIXware's simulator:
     g[0..31]   special registers rB, rD, rE, ... rZZ (enum special_reg order)
     g[rG..255] global registers $G..$255
     l[]        local register ring; $k (k < rL) is l[(O + k) & lring_mask]
                where O = rO >> 3                                            */
#include <stdio.h>

typedef unsigned int tetra;
typedef struct { tetra h, l; } octa;

extern octa g[256];
extern octa *l;
extern int lring_mask;
extern octa inst_ptr;
extern void *mem_find(octa);

octa *mmix_get_g_ptr(void) { return g; }
octa *mmix_get_l_ptr(void) { return l; }
int   mmix_get_lring_mask(void) { return lring_mask; }
int   mmix_get_inst_ptr_addr(void) { return (int)&inst_ptr; }
tetra mmix_mem_read_tetra(tetra h, tetra l) {
  octa a; a.h = h; a.l = l;
  void *p = mem_find(a);
  if (!p) return 0;
  return *(tetra *)p;
}

/* Program output goes through fwrite (mmix-io.c); the simulator's own
   messages use printf. Bracket program bytes on stdout with SO/SI so the UI
   can tell them apart in the combined stream. */
/* linked with -Wl,--wrap=fwrite */
size_t __real_fwrite(const void *, size_t, size_t, FILE *);
size_t __wrap_fwrite(const void *p, size_t size, size_t n, FILE *f) {
  size_t r;
  if (f != stdout) return __real_fwrite(p, size, n, f);
  __real_fwrite("\016", 1, 1, f);
  r = __real_fwrite(p, size, n, f);
  __real_fwrite("\017", 1, 1, f);
  return r;
}

