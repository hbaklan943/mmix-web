% Minimal standard-input demo for mmix-web.
% Reads up to 100 characters from stdin then echoes them back.
argv IS $1
     LOC Data_Segment
     GREG @
InArgs OCTA Buf,100   % (buffer, size) argument block for Fgets
Buf   LOC @
      LOC #100
Main  LDA $255,InArgs % $255 points at (.octa,.octa) arg block
      TRAP 0,Fgets,StdIn
      LDA $255,Buf
      TRAP 0,Fputs,StdOut
      TRAP 0,Halt,0
