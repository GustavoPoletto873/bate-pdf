/** Filtro comum das listas de fundos: ?busca=…&administradora=<id> (0 = sem administradora). */
export function filtroDaUrl(url: URL) {
  const adm = url.searchParams.get('administradora');
  return { busca: url.searchParams.get('busca'), administradora: adm === null || adm === '' ? null : Number(adm) };
}
