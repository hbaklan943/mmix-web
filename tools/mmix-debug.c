/* mmix-debug.c — step-debugger glue for the browser, linked only into the
   debug build of the simulator (web/wasm/mmix-debug.js, built with Asyncify).

   mmix-sim's own interactive mode (-i) already implements stepping: it pauses
   by reading a command line with fgets(stdin). We wrap fgets
   (-Wl,--wrap=fgets) so that read *awaits* the next command from the UI
   instead of blocking, which lets the simulator sit paused inside a Web
   Worker. MMIXware's sources stay unmodified.

   Breakpoints follow MMIXVD (and mmix-sim's own -i mode): execution stops
   right *after* the breakpoint instruction ran, and the UI marks the
   instruction that was executed last. They are checked here rather than via
   mmix-sim's breakpoint bits so that a long "continue" can poll for Break:
   the UI's continue command "C" makes the wrapper answer "n" (one
   instruction) by itself, with printf silenced, until a breakpoint
   instruction has run, a one-shot stop address is reached, or the program
   halts. */
#include <stdio.h>
#include <stdarg.h>
#include <string.h>
#include <emscripten.h>

typedef unsigned int tetra;
typedef struct { tetra h, l; } octa;
/* Must match mmix-sim.c (mmix-sim.w §16) */
typedef struct {
  tetra tet;
  tetra freq;
  unsigned char bkpt;
  unsigned char file_no;
  unsigned short line_no;
} mem_tetra;
typedef struct mem_node_struct {
  octa loc;
  tetra stamp;
  struct mem_node_struct *left, *right;
  mem_tetra dat[512];
} mem_node;

extern mem_node *mem_root;
extern mem_tetra *mem_find(octa);
extern octa inst_ptr;
extern int halted;            /* bool in mmix-sim.c is an int-sized enum */

static int debugging = 0;
static int continuing = 0;    /* inside a "C" (continue to breakpoint) */
static int silent = 0;        /* swallow mmix-sim's printf while continuing */

#define MAX_BP 1024
static octa bp[MAX_BP];
static int nbp = 0;
/* one-shot stop for step over / out / run to cursor:
   mode 1 = stop before executing temp_bp, mode 2 = stop after executing it */
static octa temp_bp;
static int temp_mode = 0;
static octa last_exec;        /* instruction executed by the most recent "n" */

void mmix_bp_clear(void) { nbp = 0; }
void mmix_bp_add(tetra h, tetra l) { if (nbp < MAX_BP) { bp[nbp].h = h; bp[nbp].l = l; nbp++; } }
void mmix_bp_temp(tetra h, tetra l, int mode) { temp_bp.h = h; temp_bp.l = l; temp_mode = mode; }
octa *mmix_last_exec_ptr(void) { return &last_exec; }

#define SAME(a, b) ((a).h == (b).h && (a).l == (b).l)
static int is_user_bp(octa a) {
  int i;
  for (i = 0; i < nbp; i++) if (SAME(bp[i], a)) return 1;
  return 0;
}
/* checked before each instruction of a continue */
static int should_stop(void) {
  if (halted) return 1;
  if (temp_mode == 1 && SAME(temp_bp, inst_ptr)) return 1;
  if (temp_mode == 2 && SAME(temp_bp, last_exec)) return 1;
  return is_user_bp(last_exec);
}
/* the next "n" runs the instruction at inst_ptr; remember it, and let its
   trace line through if we are going to stop right after it */
static void about_to_step(void) {
  last_exec = inst_ptr;
  if (continuing) silent = !(is_user_bp(inst_ptr) || (temp_mode == 2 && SAME(temp_bp, inst_ptr)));
}

/* Resolves with the next command line (e.g. "n\n"), see sim-worker.js. */
EM_ASYNC_JS(int, js_wait_command, (char *buf, int size), {
  const s = await Module.mmixWaitCommand();
  stringToUTF8(s, buf, size);
  return 1;
});

/* While continuing, give the worker's event loop a turn now and then so a
   "Break" from the UI can arrive; resolves to 1 if a break was requested. */
EM_ASYNC_JS(int, js_poll_break, (void), {
  return (await Module.mmixPollBreak()) ? 1 : 0;
});
#define POLL_EVERY 200000

char *__real_fgets(char *, int, FILE *);
char *__wrap_fgets(char *buf, int size, FILE *f) {
  static int countdown = POLL_EVERY;
  if (!debugging || f != stdin) return __real_fgets(buf, size, f);
  if (continuing) {
    int stop = should_stop();
    if (!stop && --countdown <= 0) { countdown = POLL_EVERY; stop = js_poll_break(); }
    if (!stop) { about_to_step(); strcpy(buf, "n\n"); return buf; }
    continuing = silent = 0;
    temp_mode = 0;
  }
  js_wait_command(buf, size);
  if (buf[0] == 'C') {
    /* the first instruction always runs: we may be sitting after a breakpoint */
    continuing = 1;
    strcpy(buf, "n\n");
  }
  if (buf[0] == 'n' || buf[0] == '\n') about_to_step();
  return buf;
}

int __wrap_printf(const char *fmt, ...) {
  va_list ap;
  int r;
  if (silent) return 0;
  va_start(ap, fmt);
  r = vprintf(fmt, ap);
  va_end(ap);
  return r;
}

/* mmix-sim's trace also prints single characters with fputc(c, stdout). */
int __real_fputc(int, FILE *);
int __wrap_fputc(int c, FILE *f) {
  if (silent && f == stdout) return c;
  return __real_fputc(c, f);
}

extern int main(int, char **);

/* Entry point for a debug session: args separated by '\n'. Called through
   ccall(..., {async: true}) so the promise settles when main returns. */
int mmix_debug_main(char *joined) {
  static char *argv[64];
  int argc = 0;
  char *p = joined;
  argv[argc++] = "mmix";
  while (*p && argc < 63) {
    argv[argc++] = p;
    while (*p && *p != '\n') p++;
    if (*p) *p++ = '\0';
  }
  argv[argc] = 0;
  debugging = 1;
  return main(argc, argv);
}

int mmix_halted(void) { return halted; }

int mmix_line_of(tetra h, tetra l) {
  octa a; mem_tetra *t;
  a.h = h; a.l = l;
  t = mem_find(a);
  return t ? t->line_no : 0;
}

/* Writes (h, l, line) triples for every loaded tetra that has a source line
   into buf; returns the number of triples (at most max). */
static int walk(mem_node *p, tetra *buf, int max, int n) {
  int j;
  if (!p || n >= max) return n;
  n = walk(p->left, buf, max, n);
  for (j = 0; j < 512 && n < max; j++) {
    if (p->dat[j].line_no) {
      buf[3 * n] = p->loc.h;              /* nodes are 2 KB aligned: no carry */
      buf[3 * n + 1] = p->loc.l + 4 * j;
      buf[3 * n + 2] = p->dat[j].line_no;
      n++;
    }
  }
  return walk(p->right, buf, max, n);
}
int mmix_line_map(tetra *buf, int max) { return walk(mem_root, buf, max, 0); }
