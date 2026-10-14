const products = [
  { id: 1, name: 'Café beans' },
  { id: 2, name: 'Tea leaves' },
  { id: 3, name: 'Coffee grinder' }
];

export function searchCatalog(query) {
  return products.map(product => ({ ...product }));
}

export function getProduct(id) {
  const product = products.find(product => product.id === id);
  return product ? { ...product } : null;
}
