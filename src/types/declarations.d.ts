declare module 'algebrite' {
  const Algebrite: {
    simplify(expr: string): { toString(): string };
    derivative(expr: string, variable: string): { toString(): string };
    integral(expr: string, variable: string): { toString(): string };
    taylor(expr: string, variable: string, order: number): { toString(): string };
    roots(expr: string): { toString(): string };
    expand(expr: string): { toString(): string };
    factor(expr: string): { toString(): string };
    eval(expr: string): { toString(): string };
    defint(expr: string, variable: string, a: number, b: number): { toString(): string };
  };
  export default Algebrite;
}

declare module 'nerdamer' {
  const nerdamer: {
    (expr: string): nerdamer.Expression;
    diff(expr: string, variable: string): nerdamer.Expression;
    integrate(expr: string, variable: string): nerdamer.Expression;
    solveEquations(expr: string, variable?: string): nerdamer.Expression;
    load(...modules: string[]): void;
  } & Record<string, unknown>;
  namespace nerdamer {
    interface Expression {
      evaluate(): Expression;
      toString(): string;
      text(): string;
      toTeX(): string;
    }
  }
  export default nerdamer;
}
