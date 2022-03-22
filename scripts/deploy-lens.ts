import { deploy } from "./utils";

async function main() {
  // Rinkeby only
  await deploy('Lens', '0x3ebB5694bB99ADa53026CaCfEb3cb9F6249F5310');
  await deploy('Quoter', '0xA488583a8B2Caecf8e9A576e514E64C8f3B744c8');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
