/**
 * Associa os registros em O(P + I + C), sem realizar novas consultas.
 * A prioridade da associação é a mesma do código legado: imóvel vinculado
 * diretamente ao inquilino, ou primeiro contrato da lista como alternativa.
 */
export function linkCatalog(data) {
    const properties = data.imoveis ?? [];
    const tenants = data.inquilinos ?? [];
    const contracts = data.contratos ?? [];
    const propertiesById = new Map(properties.map((row) => [row.id, row]));
    const tenantsById = new Map(tenants.map((row) => [row.id, row]));
    const contractsById = new Map(contracts.map((row) => [row.id, row]));
    const directPropertyByTenant = new Map();
    const firstContractByTenant = new Map();
    for (const property of properties) {
        const tenantId = property.inquilino_id;
        if (tenantId && !directPropertyByTenant.has(tenantId)) {
            directPropertyByTenant.set(tenantId, property);
        }
    }
    for (const contract of contracts) {
        const tenantId = contract.inquilino_id;
        if (tenantId && !firstContractByTenant.has(tenantId)) {
            firstContractByTenant.set(tenantId, contract);
        }
    }
    return {
        propertiesById,
        tenantsById,
        contractsById,
        homeForTenant(tenantId) {
            if (!tenantId)
                return undefined;
            const direct = directPropertyByTenant.get(tenantId);
            if (direct)
                return direct;
            const contract = firstContractByTenant.get(tenantId);
            return contract?.imovel_id ? propertiesById.get(contract.imovel_id) : undefined;
        },
    };
}
const MAX_PER_TYPE = 8;
const DEFAULT_LIMIT = 30;
export function normalize(value) {
    return String(value == null ? '' : value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}
export function searchIndex(items, query, kind = 'todos', limit = DEFAULT_LIMIT) {
    const tokens = normalize(query).split(' ').filter(Boolean);
    if (tokens.length === 0)
        return [];
    const matches = items.filter((item) => (kind === 'todos' || kind === item.kind) &&
        tokens.every((term) => item.searchText.indexOf(term) >= 0));
    const full = normalize(query);
    const rank = (item) => {
        const title = normalize(item.title);
        const subtitle = normalize(item.subtitle);
        if (title === full)
            return 0;
        if (title.startsWith(full))
            return 1;
        if (title.includes(full))
            return 2;
        if (subtitle.includes(full))
            return 3;
        return 4;
    };
    matches.sort((a, b) => rank(a) - rank(b) ||
        a.kind.localeCompare(b.kind) ||
        a.title.localeCompare(b.title, 'pt-BR'));
    const countByType = {};
    const output = [];
    for (const item of matches) {
        if (output.length >= (limit || DEFAULT_LIMIT))
            break;
        const count = countByType[item.kind] || 0;
        if (kind !== 'todos' || count < MAX_PER_TYPE) {
            output.push(item);
            countByType[item.kind] = count + 1;
        }
    }
    return output;
}
if (typeof window !== 'undefined') {
    window.MatosSearchCore = { normalize, searchIndex, linkCatalog };
}
