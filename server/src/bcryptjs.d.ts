declare module "bcryptjs" {
  const bcrypt: {
    hashSync(value: string, saltRounds: number): string;
    compareSync(value: string, hash: string): boolean;
  };
  export default bcrypt;
}
