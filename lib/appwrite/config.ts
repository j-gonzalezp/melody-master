export const appwriteConfig = {
    endpointUrl: process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!,
    projectId: process.env.NEXT_PUBLIC_APPWRITE_PROJECT!,
    databaseId: process.env.NEXT_PUBLIC_APPWRITE_DATABASE!,
    groupProgressCollectionId: process.env.NEXT_PUBLIC_APPWRITE_GROUPPROGRESS_COLLECTION!,
    secretKey: process.env.NEXT_APPWRITE_KEY!
}