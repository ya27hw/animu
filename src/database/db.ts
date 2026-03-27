import { FirebaseApp, initializeApp } from "firebase/app";
import { firebaseConfig } from "./creds.json";
import { id, aniUserName, email, emailPassword } from "profile.json";
import { AniQuery } from "@utils/index";
import {
  getAuth,
  signInWithEmailAndPassword,
  UserCredential,
} from "firebase/auth";
import {
  deleteDoc,
  doc,
  DocumentData,
  Firestore,
  getDoc,
  getFirestore,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";

class DB {
  private myProject: FirebaseApp;
  private static user: UserCredential;
  private db : Firestore;
  constructor() {
    this.myProject = initializeApp(firebaseConfig);
    this.db = getFirestore(this.myProject);
  }

  public async logIn() {
    try {
    const auth = getAuth();
    DB.user = await signInWithEmailAndPassword(auth, email, emailPassword);
  } catch(e) {process.exit(0)}}

  /**
   * Adds data to firestore
   * @param  {any[]} data
   * @returns Promise
   */
  public async addToDb(...data: AniQuery[]): Promise<void> {
    for (let i = 0; i < data.length; i++) {
      const dataToAdd = data[i];

      await setDoc(
        doc(
          this.db,
          "animelists",
          DB.user.user?.uid,
          "anime",
          dataToAdd["mediaId"].toString()
        ),
        {
          ...dataToAdd,
          pendingRewatchingUpdate: false,
        }
      );
    }
  }

  public async modifyAnimeEntry(mediaId: string, data: any) {
    try {
      await updateDoc(
        doc(this.db, "animelists", DB.user.user?.uid, "anime", mediaId),
        data
      );

      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  public async deleteAnimeEntry(mediaId: string): Promise<void> {
    try {
      await deleteDoc(
        doc(this.db, "animelists", DB.user.user?.uid, "anime", mediaId)
      );
    } catch (error) {
      console.error(error);
    }
  }
  /**
   * Gets the anime entry by mediaId
   * @param  {string} mediaId
   * @returns Promise of DocumentSnapshot
   */
  public async getByMediaId(
    mediaId: string
  ): Promise<DocumentData | undefined> {
    const docSnap = await getDoc(
      doc(this.db, "animelists", DB.user.user?.uid, "anime", mediaId)
    );
    if (docSnap.exists()) return docSnap.data();
    return undefined;
  }
  /**
   * Gets the anime entires from a users animelist (in bulk)
   * @param  {string[]} ...mediaId - Anime mediaIds
   * @returns Promise - Contains an array of anime entries found on firebase
   */
  public async getAnimeEntries(...mediaId: string[]): Promise<any[]> {
    let animeEntries = [];
    for (let i = 0; i < mediaId.length; i++) {
      const data = await this.getByMediaId(mediaId[i]);

      // Make sure the data is not undefined
      if (data) {
        animeEntries.push(data);
      }
    }
    return animeEntries;
  }

  /**
   * Gets the users animelist
   * @returns {Promise}
   */
  public async getFromDb(): Promise<DocumentData | undefined> {
    try {
      const docSnap = await getDoc(
        doc(this.db, "animelists", DB.user.user?.uid, "anime")
      );
      if (docSnap.exists()) return docSnap.data();
      return undefined;
    } catch (error) {
      console.error(error);
      return undefined;
    }
  }

  public async createUserDB() {
    await setDoc(doc(this.db, "animelists", DB.user.user?.uid), {
      userId: DB.user.user?.uid,
      userName: aniUserName,
      "Anilist ID": id,
      "Date Created": Timestamp.now(),
    });
  }
}
export default new DB();
